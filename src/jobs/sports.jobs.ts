import type { Job } from 'bullmq';

import { logger } from '@config/logger.config';

import { AppConstants } from '@common/constants';
import { QueueName, SportsProviderKey, type Sport, SyncSource } from '@common/enums';

import { sportsCacheService } from '@modules/sports/sports-cache.service';
import { sportsIngestionService } from '@modules/sports/sports-ingestion.service';

import { getQueue, registerWorker } from '@queues/queue.factory';

/**
 * BullMQ workers + recurring schedulers for the Phase 4 sports pipeline.
 *
 * Four queues run in parallel:
 *   - MATCH_SYNC          → match list / fixture refresh (every 5 min)
 *   - LIVE_SCORE_SYNC     → live score ticks (every 10 sec while there's
 *                            at least one LIVE match)
 *   - PLAYER_SYNC         → daily roster refresh
 *   - SPORTS_CACHE_REFRESH→ pre-warms hot cache keys
 *
 *  Each worker:
 *   - has its own retry policy (sports-specific defaults from `AppConstants`),
 *   - logs every job result for observability,
 *   - is resilient: a job failure NEVER takes the rest of the API down.
 *
 *  The scheduler upserts repeatable jobs with stable keys so re-deploying
 *  doesn't fan out duplicates. Stopping a job is as easy as removing its
 *  `repeat` entry — handled by `unscheduleSportsJobs()` on shutdown.
 */

export interface SportsJobPayload {
  source?: SyncSource;
  provider?: SportsProviderKey;
  sport?: Sport;
}

const REPEAT_KEYS = {
  matchList: 'sports.match-sync.scheduled',
  liveScore: 'sports.live-score.scheduled',
  playerRoster: 'sports.player-sync.scheduled',
  cacheRefresh: 'sports.cache-refresh.scheduled',
};

const defaultJobOpts = () => ({
  attempts: AppConstants.SPORTS.SYNC_JOB.MAX_ATTEMPTS,
  backoff: { type: 'exponential' as const, delay: AppConstants.SPORTS.SYNC_JOB.BACKOFF_MS },
});

/**
 * Register all four workers + schedule the recurring jobs.
 *
 * Called once during boot from the loader. Idempotent — re-running on
 * hot reload just re-registers the same workers.
 */
export const initSportsJobs = async (): Promise<void> => {
  registerMatchSyncWorker();
  registerLiveScoreWorker();
  registerPlayerSyncWorker();
  registerCacheRefreshWorker();

  await scheduleRepeatableJobs();
  // Kick off a one-shot full sync on boot so a fresh DB has
  // tournaments / teams / players / matches available immediately for
  // the create-team UI — without waiting for the 5-min match cron or
  // the 24-h player roster cron.
  await enqueueInitialSync();
  logger.info({ event: 'sports.jobs.init' }, 'Sports jobs registered + scheduled');
};

const enqueueInitialSync = async (): Promise<void> => {
  const matchQ = getQueue<SportsJobPayload>(QueueName.MATCH_SYNC);
  try {
    await matchQ.add(
      'initial-sync',
      { source: SyncSource.SYSTEM_BOOT },
      { ...defaultJobOpts(), jobId: 'sports.match-sync.bootstrap' },
    );
  } catch (err) {
    logger.warn({ err, event: 'sports.jobs.bootstrap.failed' }, 'initial sync enqueue failed');
  }
};

/**
 * Removes the recurring `repeat` entries. The Queue + Worker objects are
 * closed by the central `closeAllQueues()` shutdown path.
 */
export const unscheduleSportsJobs = async (): Promise<void> => {
  const matchQ = getQueue<SportsJobPayload>(QueueName.MATCH_SYNC);
  const liveQ = getQueue<SportsJobPayload>(QueueName.LIVE_SCORE_SYNC);
  const playerQ = getQueue<SportsJobPayload>(QueueName.PLAYER_SYNC);
  const cacheQ = getQueue<SportsJobPayload>(QueueName.SPORTS_CACHE_REFRESH);

  await Promise.allSettled([
    matchQ.removeRepeatableByKey?.(REPEAT_KEYS.matchList),
    liveQ.removeRepeatableByKey?.(REPEAT_KEYS.liveScore),
    playerQ.removeRepeatableByKey?.(REPEAT_KEYS.playerRoster),
    cacheQ.removeRepeatableByKey?.(REPEAT_KEYS.cacheRefresh),
  ]);
};

// ─── Worker registration ──────────────────────────────────────────────────

const registerMatchSyncWorker = (): void => {
  registerWorker<SportsJobPayload>(
    QueueName.MATCH_SYNC,
    async (job: Job<SportsJobPayload>) => {
      const report = await sportsIngestionService.syncAll({
        provider: job.data.provider,
        sport: job.data.sport,
        source: job.data.source ?? SyncSource.SCHEDULED,
      });
      logger.info(
        {
          event: 'sports.job.match-sync',
          provider: report.provider,
          matches: report.matchesUpserted,
          status: report.matchesStatusChanged,
        },
        'match-sync job complete',
      );

      // Phase 7 bridge — when matches flip to COMPLETED, queue final
      // scoring + settlement for every contest tied to them. Best-effort:
      // failures are logged but never bubble back to the sync job.
      try {
        await autoTriggerSettlementForCompletedMatches();
      } catch (err) {
        logger.warn(
          { err, event: 'sports.job.match-sync.settlement-bridge.failed' },
          'failed to auto-trigger settlement',
        );
      }
    },
    { concurrency: 1 },
  );
};

/**
 * Scans for matches that completed in the last 24h and enqueues:
 *   1. A FINAL_RECONCILE scoring pass.
 *   2. A delayed settlement job for every OPEN/LIVE/COMPLETED contest
 *      tied to them.
 *
 * Idempotent — settlement uses contestId-prefixed `jobId` so duplicate
 * enqueues are no-ops, and the contest_results row guards against
 * double-runs.
 */
const autoTriggerSettlementForCompletedMatches = async (): Promise<void> => {
  const { Match } = await import('@modules/sports/match.model');
  const { Contest } = await import('@modules/contest/contest.model');
  const { ContestStatus, MatchStatus, ScoreEventType, ContestSettlementStatus } = await import(
    '@common/enums'
  );
  const { contestResultRepository } = await import(
    '@modules/leaderboard/contest-result.repository'
  );
  const { enqueueScoringRecompute, enqueueContestSettlement } = await import('./scoring.jobs');

  const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
  const matches = await Match.find({
    status: MatchStatus.COMPLETED,
    completedAt: { $gte: cutoff },
  })
    .select({ _id: 1 })
    .limit(50)
    .exec();
  if (matches.length === 0) return;

  for (const m of matches) {
    await enqueueScoringRecompute({
      matchId: String(m._id),
      type: ScoreEventType.FINAL_RECONCILE,
      reason: 'auto-final-after-match-complete',
    });

    const contests = await Contest.find({
      matchId: m._id,
      status: { $in: [ContestStatus.OPEN, ContestStatus.LIVE, ContestStatus.LOCKED, ContestStatus.COMPLETED] },
    })
      .select({ _id: 1 })
      .exec();

    for (const c of contests) {
      const existing = await contestResultRepository.findByContestId(c._id);
      if (existing?.status === ContestSettlementStatus.SETTLED) continue;
      if (existing?.status === ContestSettlementStatus.IN_PROGRESS) continue;
      await enqueueContestSettlement({ contestId: String(c._id) });
    }
  }
};

const registerLiveScoreWorker = (): void => {
  registerWorker<SportsJobPayload>(
    QueueName.LIVE_SCORE_SYNC,
    async (job: Job<SportsJobPayload>) => {
      const result = await sportsIngestionService.syncLiveScores({
        provider: job.data.provider,
        sport: job.data.sport,
        source: job.data.source ?? SyncSource.SCHEDULED,
      });
      if (result.eventsIngested > 0) {
        logger.info(
          { event: 'sports.job.live-score', ...result },
          'live-score job ingested events',
        );

        // Phase 7 bridge — fan out scoring jobs for every match that
        // received new events. The scoring worker is decoupled from
        // ingestion so a Phase-7 hiccup never blocks Phase-4 ingestion.
        if (Array.isArray(result.matchIds) && result.matchIds.length > 0) {
          try {
            const { enqueueScoringRecompute } = await import('./scoring.jobs');
            const { ScoreEventType } = await import('@common/enums');
            for (const matchId of result.matchIds) {
              await enqueueScoringRecompute({
                matchId,
                type: ScoreEventType.LIVE_TICK,
                reason: 'live-score-sync',
              });
            }
          } catch (err) {
            logger.warn(
              { err, event: 'sports.job.live-score.scoring-bridge.failed' },
              'failed to enqueue scoring recompute',
            );
          }
        }
      }
    },
    { concurrency: 2 },
  );
};

const registerPlayerSyncWorker = (): void => {
  registerWorker<SportsJobPayload>(
    QueueName.PLAYER_SYNC,
    async (job: Job<SportsJobPayload>) => {
      const { sportsProviderRegistry } = await import('@modules/sports/sports-provider.registry');
      const provider = job.data.provider
        ? sportsProviderRegistry.get(job.data.provider) ?? sportsProviderRegistry.list()[0]
        : sportsProviderRegistry.list()[0];
      if (!provider) {
        logger.warn({ event: 'sports.job.player-sync.skip' }, 'No provider registered');
        return;
      }
      const count = await sportsIngestionService.syncPlayers(provider, {
        provider: provider.key,
        sport: job.data.sport,
        source: job.data.source ?? SyncSource.SCHEDULED,
      });
      logger.info({ event: 'sports.job.player-sync', count }, 'player-sync job complete');
    },
    { concurrency: 1 },
  );
};

const registerCacheRefreshWorker = (): void => {
  registerWorker<SportsJobPayload>(
    QueueName.SPORTS_CACHE_REFRESH,
    async () => {
      // Cheap, low-priority sweep: drop the hot caches so the next user
      // request pulls fresh data. We DON'T pre-warm here — that would
      // require pretending to be a user, which is wasteful. Just drop.
      await sportsCacheService.flushScope('matches');
      logger.debug({ event: 'sports.job.cache-refresh' }, 'cache-refresh job complete');
    },
    { concurrency: 1 },
  );
};

// ─── Scheduling ───────────────────────────────────────────────────────────

const scheduleRepeatableJobs = async (): Promise<void> => {
  const matchQ = getQueue<SportsJobPayload>(QueueName.MATCH_SYNC);
  const liveQ = getQueue<SportsJobPayload>(QueueName.LIVE_SCORE_SYNC);
  const playerQ = getQueue<SportsJobPayload>(QueueName.PLAYER_SYNC);
  const cacheQ = getQueue<SportsJobPayload>(QueueName.SPORTS_CACHE_REFRESH);

  await Promise.all([
    matchQ.add(
      'tick',
      { source: SyncSource.SCHEDULED },
      {
        repeat: {
          every: AppConstants.SPORTS.SYNC_INTERVAL_MS.MATCH_LIST,
          key: REPEAT_KEYS.matchList,
        },
        ...defaultJobOpts(),
      },
    ),
    liveQ.add(
      'tick',
      { source: SyncSource.SCHEDULED },
      {
        repeat: {
          every: AppConstants.SPORTS.SYNC_INTERVAL_MS.LIVE_SCORE,
          key: REPEAT_KEYS.liveScore,
        },
        ...defaultJobOpts(),
      },
    ),
    playerQ.add(
      'tick',
      { source: SyncSource.SCHEDULED },
      {
        repeat: {
          every: AppConstants.SPORTS.SYNC_INTERVAL_MS.PLAYER_ROSTER,
          key: REPEAT_KEYS.playerRoster,
        },
        ...defaultJobOpts(),
      },
    ),
    cacheQ.add(
      'tick',
      { source: SyncSource.SCHEDULED },
      {
        repeat: {
          every: AppConstants.SPORTS.SYNC_INTERVAL_MS.CACHE_REFRESH,
          key: REPEAT_KEYS.cacheRefresh,
        },
        ...defaultJobOpts(),
      },
    ),
  ]);
};

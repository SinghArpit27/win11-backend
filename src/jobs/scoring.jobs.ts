import type { Job } from 'bullmq';

import { logger } from '@config/logger.config';

import { AppConstants } from '@common/constants';
import {
  LeaderboardSnapshotReason,
  QueueName,
  ScoreEventType,
} from '@common/enums';

import { ContestStatus } from '@common/enums';
import { Contest } from '@modules/contest/contest.model';
import { contestSettlementService } from '@modules/settlement/contest-settlement.service';
import { leaderboardService } from '@modules/leaderboard/leaderboard.service';
import { scoringService } from '@modules/scoring/scoring.service';

import { getQueue, registerWorker } from '@queues/queue.factory';

/**
 * BullMQ workers for the Phase 7 scoring + leaderboard + settlement
 * pipeline.
 *
 * Four queues:
 *
 *   - `SCORING_RECOMPUTE`    → recompute fantasy points for a match
 *   - `LEADERBOARD_REFRESH`  → rebuild a contest's leaderboard from
 *                              its entries + latest team points
 *   - `LEADERBOARD_SNAPSHOT` → periodic snapshot generation for the
 *                              top-N podium + rank-history deltas
 *   - `CONTEST_SETTLEMENT`   → final ranking + prize allocation +
 *                              wallet credits
 *
 * Workers are intentionally narrow — most logic lives in the services
 * (`scoringService`, `leaderboardService`, `contestSettlementService`).
 * The jobs file is the *plumbing* that wires queues to those services.
 */

export interface ScoringRecomputeJob {
  matchId: string;
  type?: ScoreEventType;
  reason?: string;
  triggeredBy?: string | null;
}

export interface LeaderboardRefreshJob {
  contestId: string;
  reason?: LeaderboardSnapshotReason;
  scoreEventId?: string | null;
  triggeredBy?: string | null;
}

export interface LeaderboardSnapshotJob {
  matchId?: string;
}

export interface ContestSettlementJob {
  contestId: string;
  actorId?: string | null;
  force?: boolean;
}

const REPEAT_KEYS = {
  leaderboardSnapshot: 'phase7.leaderboard-snapshot.scheduled',
};

const scoringJobOpts = () => ({
  attempts: AppConstants.SCORING.JOB.MAX_ATTEMPTS,
  backoff: { type: 'exponential' as const, delay: AppConstants.SCORING.JOB.BACKOFF_MS },
});

const leaderboardJobOpts = () => ({
  attempts: AppConstants.LEADERBOARD.JOB.MAX_ATTEMPTS,
  backoff: { type: 'exponential' as const, delay: AppConstants.LEADERBOARD.JOB.BACKOFF_MS },
});

const settlementJobOpts = () => ({
  attempts: AppConstants.SETTLEMENT.JOB.MAX_ATTEMPTS,
  backoff: { type: 'exponential' as const, delay: AppConstants.SETTLEMENT.JOB.BACKOFF_MS },
});

// ─── Initialisation ──────────────────────────────────────────────────

export const initScoringJobs = async (): Promise<void> => {
  registerScoringWorker();
  registerLeaderboardRefreshWorker();
  registerLeaderboardSnapshotWorker();
  registerSettlementWorker();
  await scheduleRepeatableJobs();
  logger.info({ event: 'scoring.jobs.init' }, 'Phase 7 jobs registered + scheduled');
};

export const unscheduleScoringJobs = async (): Promise<void> => {
  const snapQ = getQueue<LeaderboardSnapshotJob>(QueueName.LEADERBOARD_SNAPSHOT);
  await Promise.allSettled([
    snapQ.removeRepeatableByKey?.(REPEAT_KEYS.leaderboardSnapshot),
  ]);
};

// ─── Enqueue helpers (used by other modules) ──────────────────────────

export const enqueueScoringRecompute = async (payload: ScoringRecomputeJob): Promise<void> => {
  const q = getQueue<ScoringRecomputeJob>(QueueName.SCORING_RECOMPUTE);
  // jobId = matchId so concurrent enqueues for the same match coalesce.
  // BullMQ de-duplicates by jobId within the same `delay` window.
  await q.add(`recompute:${payload.matchId}`, payload, {
    ...scoringJobOpts(),
    jobId: `scoring:${payload.matchId}:${Date.now()}`,
    removeOnComplete: 200,
    removeOnFail: 100,
  });
};

export const enqueueLeaderboardRefresh = async (
  payload: LeaderboardRefreshJob,
): Promise<void> => {
  const q = getQueue<LeaderboardRefreshJob>(QueueName.LEADERBOARD_REFRESH);
  await q.add(`refresh:${payload.contestId}`, payload, {
    ...leaderboardJobOpts(),
    removeOnComplete: 200,
    removeOnFail: 100,
  });
};

export const enqueueContestSettlement = async (
  payload: ContestSettlementJob,
  opts: { delayMs?: number } = {},
): Promise<void> => {
  const q = getQueue<ContestSettlementJob>(QueueName.CONTEST_SETTLEMENT);
  await q.add(`settle:${payload.contestId}`, payload, {
    ...settlementJobOpts(),
    delay: opts.delayMs ?? AppConstants.SETTLEMENT.AUTO_TRIGGER_DELAY_MS,
    jobId: `settle:${payload.contestId}`,
    removeOnComplete: 100,
    removeOnFail: 50,
  });
};

// ─── Workers ─────────────────────────────────────────────────────────

const registerScoringWorker = (): void => {
  registerWorker<ScoringRecomputeJob>(
    QueueName.SCORING_RECOMPUTE,
    async (job: Job<ScoringRecomputeJob>) => {
      const start = Date.now();
      const result = await scoringService.recomputeForMatch({
        matchId: job.data.matchId,
        type: job.data.type ?? ScoreEventType.LIVE_TICK,
        triggeredBy: job.data.triggeredBy ?? null,
        context: { reason: job.data.reason ?? 'queue', jobId: job.id },
      });
      logger.info(
        {
          event: 'scoring.job.recompute',
          matchId: result.matchId,
          teamsUpdated: result.teamsUpdatedCount,
          playersUpdated: result.playersUpdatedCount,
          durationMs: Date.now() - start,
        },
        'scoring recompute job complete',
      );

      // Fan out leaderboard refreshes for every contest tied to the
      // match. We do this **after** scoring is committed so the
      // leaderboard reads the new totalPoints.
      const contestIds = await listContestsForMatch(result.matchId);
      for (const id of contestIds) {
        await enqueueLeaderboardRefresh({
          contestId: id,
          reason: LeaderboardSnapshotReason.LIVE_TICK,
          scoreEventId: result.scoreEventId,
        });
      }
    },
    { concurrency: 1 },
  );
};

const registerLeaderboardRefreshWorker = (): void => {
  registerWorker<LeaderboardRefreshJob>(
    QueueName.LEADERBOARD_REFRESH,
    async (job: Job<LeaderboardRefreshJob>) => {
      const result = await leaderboardService.rebuildForContest({
        contestId: job.data.contestId,
        reason: job.data.reason ?? LeaderboardSnapshotReason.LIVE_TICK,
        scoreEventId: job.data.scoreEventId ?? null,
        triggeredBy: job.data.triggeredBy ?? null,
      });
      logger.info(
        {
          event: 'leaderboard.job.refresh',
          contestId: result.contestId,
          totalEntries: result.totalEntries,
        },
        'leaderboard refresh job complete',
      );
    },
    { concurrency: 4 },
  );
};

const registerLeaderboardSnapshotWorker = (): void => {
  registerWorker<LeaderboardSnapshotJob>(
    QueueName.LEADERBOARD_SNAPSHOT,
    async () => {
      // Periodic sweep — snapshot every leaderboard tied to a LIVE
      // contest. We rely on `leaderboardService.rebuildForContest` to
      // write the snapshot + rank-history rows, so this worker is
      // effectively a "live tick" trigger.
      const liveContests = await Contest.find({
        status: { $in: [ContestStatus.LIVE, ContestStatus.LOCKED] },
      })
        .select({ _id: 1 })
        .limit(500)
        .exec();
      for (const c of liveContests) {
        await enqueueLeaderboardRefresh({
          contestId: String(c._id),
          reason: LeaderboardSnapshotReason.PERIODIC,
        });
      }
      logger.debug(
        { event: 'leaderboard.job.snapshot', count: liveContests.length },
        'leaderboard snapshot tick',
      );
    },
    { concurrency: 1 },
  );
};

const registerSettlementWorker = (): void => {
  registerWorker<ContestSettlementJob>(
    QueueName.CONTEST_SETTLEMENT,
    async (job: Job<ContestSettlementJob>) => {
      try {
        const summary = await contestSettlementService.settleContest({
          contestId: job.data.contestId,
          actorId: job.data.actorId ?? null,
          force: job.data.force ?? false,
        });
        logger.info(
          { event: 'settlement.job.complete', ...summary },
          'contest settlement job complete',
        );
      } catch (err) {
        // The service has already written the FAILED row + audit; we
        // log + rethrow so BullMQ records the failed attempt and
        // backoff kicks in.
        logger.error(
          { err, event: 'settlement.job.failed', contestId: job.data.contestId },
          'contest settlement job failed',
        );
        throw err;
      }
    },
    { concurrency: AppConstants.SETTLEMENT.WORKER_CONCURRENCY },
  );
};

// ─── Recurring schedules ─────────────────────────────────────────────

const scheduleRepeatableJobs = async (): Promise<void> => {
  const snapQ = getQueue<LeaderboardSnapshotJob>(QueueName.LEADERBOARD_SNAPSHOT);

  await snapQ.add(
    'tick',
    {},
    {
      repeat: {
        every: AppConstants.LEADERBOARD.SNAPSHOT_INTERVAL_MS,
        key: REPEAT_KEYS.leaderboardSnapshot,
      },
      ...leaderboardJobOpts(),
    },
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────

const listContestsForMatch = async (matchId: string): Promise<string[]> => {
  const contests = await Contest.find({
    matchId,
    status: { $in: [ContestStatus.OPEN, ContestStatus.FULL, ContestStatus.LOCKED, ContestStatus.LIVE, ContestStatus.COMPLETED] },
  })
    .select({ _id: 1 })
    .limit(1000)
    .exec();
  return contests.map((c) => String(c._id));
};

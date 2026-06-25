import { type ClientSession, type HydratedDocument, type Model, Types } from 'mongoose';

import { env } from '@config/env.config';
import { logger } from '@config/logger.config';

import {
  AuditAction,
  MatchStatus,
  MatchUpdateType,
  Sport,
  SportsProviderKey,
  SyncSource,
} from '@common/enums';
import { withTransaction } from '@common/utils/transaction.util';

import { auditLogger } from '@common/logging';

import { matchUpdateRepository } from './match-update.repository';
import { Match, type IMatch } from './match.model';
import { matchRepository } from './match.repository';
import { Player, type IPlayer } from './player.model';
import {
  matchTransformer,
  playerTransformer,
  teamTransformer,
  tournamentTransformer,
} from './sports.transformers';
import { sportsCacheService } from './sports-cache.service';
import { sportsProviderRegistry } from './sports-provider.registry';
import type {
  ISportsProvider,
  ProviderLiveUpdateDTO,
} from './sports-provider.types';
import type { SportsSyncReport } from './sports.types';
import { Team, type ITeam } from './team.model';
import { Tournament, type ITournament } from './tournament.model';

/**
 * Sports ingestion orchestrator.
 *
 * Pulls data from a provider (defaulting to the highest-priority one in
 * the registry), normalises it through the transformers, and upserts the
 * canonical entities inside a single MongoDB transaction so an interrupted
 * sync never leaves the catalogue in a partially-written state.
 *
 * Public surface:
 *   - syncAll(opts)       — tournaments + teams + players + matches
 *   - syncMatches(opts)   — matches only (most common cron path)
 *   - syncLiveScores(opts)— append match_updates + refresh the live snapshot
 *   - syncPlayers(opts)   — roster refresh (daily)
 *
 * Observability:
 *   - Every run emits a `SportsSyncReport` for the caller to log / show
 *     in the admin UI.
 *   - Audit log entries are written for STARTED / COMPLETED / FAILED.
 */
class SportsIngestionService {
  /**
   * One-shot end-to-end sync. Resolves entity dependencies in order:
   *   1. Tournaments  (no deps)
   *   2. Teams        (no deps)
   *   3. Players      (depends on Teams)
   *   4. Matches      (depends on Tournaments + Teams)
   * Each step is its own Mongo transaction so a failure in players doesn't
   * roll back tournament+team progress.
   */
  /**
   * Lightweight boot/cron refresh — re-pulls matches from the active provider,
   * reconciles stale statuses, and flushes match caches. Used when Redis
   * workers are offline so the catalogue doesn't freeze on old mock rows.
   */
  async refreshMatchCatalogue(opts: SyncOptions = {}): Promise<SportsSyncReport> {
    const sport = opts.sport ?? Sport.CRICKET;
    const provider = this.resolveProvider(opts.provider, sport);
    const report = createReport(provider.key);

    await this.audit(AuditAction.SPORTS_SYNC_STARTED, opts, provider);

    try {
      const entityMaps = await this.loadEntityMaps(provider.key);

      await this.runStep(report, 'matches', async () => {
        const { upserted, statusChanged } = await this.syncMatches(provider, { ...opts, sport }, entityMaps);
        report.matchesUpserted = upserted;
        report.matchesStatusChanged = statusChanged;
      });

      report.matchesStatusChanged += await this.reconcileCatalogue();
      await sportsCacheService.flushScope('matches');
      report.completedAt = new Date().toISOString();
      await this.audit(AuditAction.SPORTS_SYNC_COMPLETED, opts, provider);
      return report;
    } catch (err) {
      const message = (err as Error).message;
      report.errors.push({ scope: 'refreshMatchCatalogue', message });
      await this.audit(AuditAction.SPORTS_SYNC_FAILED, opts, provider, message);
      throw err;
    }
  }

  /**
   * Heals stale rows and clears mock LIVE placeholders when a real API key
   * is configured. Safe to run even when upstream sync failed (quota, etc.).
   */
  async reconcileCatalogueOnly(opts: SyncOptions = {}): Promise<number> {
    const changed = await this.reconcileCatalogue();
    await sportsCacheService.flushScope('matches');
    if (opts.provider) {
      const provider = this.resolveProvider(opts.provider, opts.sport);
      await this.audit(AuditAction.SPORTS_SYNC_COMPLETED, opts, provider);
    }
    return changed;
  }

  /** Build provider-id → Mongo `_id` maps from existing catalogue rows. */
  async loadEntityMaps(providerKey: SportsProviderKey): Promise<{
    tournamentMap: Map<string, Types.ObjectId>;
    teamMap: Map<string, Types.ObjectId>;
  }> {
    const tournamentMap = new Map<string, Types.ObjectId>();
    const teamMap = new Map<string, Types.ObjectId>();

    const [tournaments, teams] = await Promise.all([
      Tournament.find({ 'externalIds.providerKey': providerKey })
        .select('_id externalIds')
        .lean()
        .exec(),
      Team.find({ 'externalIds.providerKey': providerKey })
        .select('_id externalIds')
        .lean()
        .exec(),
    ]);

    for (const doc of tournaments) {
      for (const ext of doc.externalIds ?? []) {
        if (ext.providerKey === providerKey) {
          tournamentMap.set(ext.id, doc._id as Types.ObjectId);
        }
      }
    }

    for (const doc of teams) {
      for (const ext of doc.externalIds ?? []) {
        if (ext.providerKey === providerKey) {
          teamMap.set(ext.id, doc._id as Types.ObjectId);
        }
      }
    }

    return { tournamentMap, teamMap };
  }

  private async reconcileCatalogue(): Promise<number> {
    const [reconciled, mockRetired] = await Promise.all([
      matchRepository.reconcileStaleStatuses(),
      env.CRIC_API_KEY ? matchRepository.retireMockLiveMatches() : Promise.resolve(0),
    ]);
    return reconciled + mockRetired;
  }

  async syncAll(opts: SyncOptions = {}): Promise<SportsSyncReport> {
    const provider = this.resolveProvider(opts.provider, opts.sport);
    const report = createReport(provider.key);

    await this.audit(AuditAction.SPORTS_SYNC_STARTED, opts, provider);

    try {
      const tournamentMap = await this.runStep(report, 'tournaments', async () => {
        const map = await this.syncTournaments(provider, opts);
        report.tournamentsUpserted = map.size;
        return map;
      });

      const teamMap = await this.runStep(report, 'teams', async () => {
        const map = await this.syncTeams(provider, opts);
        report.teamsUpserted = map.size;
        return map;
      });

      await this.runStep(report, 'players', async () => {
        const count = await this.syncPlayers(provider, opts, teamMap);
        report.playersUpserted = count;
      });

      await this.runStep(report, 'matches', async () => {
        const { upserted, statusChanged } = await this.syncMatches(provider, opts, {
          tournamentMap,
          teamMap,
        });
        report.matchesUpserted = upserted;
        report.matchesStatusChanged = statusChanged;
      });

      await sportsCacheService.flushScope('matches');
    } catch (err) {
      const message = (err as Error).message;
      report.errors.push({ scope: 'syncAll', message });
      await this.audit(AuditAction.SPORTS_SYNC_FAILED, opts, provider, message);
      throw err;
    }

    report.completedAt = new Date().toISOString();
    await this.audit(AuditAction.SPORTS_SYNC_COMPLETED, opts, provider);
    return report;
  }

  /** Upserts every tournament returned by the provider; returns ID map. */
  async syncTournaments(
    provider: ISportsProvider,
    opts: SyncOptions,
  ): Promise<Map<string, Types.ObjectId>> {
    const dtos = await provider.fetchTournaments({ sport: opts.sport });
    const map = new Map<string, Types.ObjectId>();

    await withTransaction(async (session) => {
      for (const dto of dtos) {
        const entity = tournamentTransformer.toEntity(provider.key, dto);
        const doc = await upsertByExternalId<ITournament>(
          Tournament,
          provider.key,
          dto.id,
          entity,
          session,
        );
        map.set(dto.id, doc._id as Types.ObjectId);
      }
    });
    return map;
  }

  async syncTeams(
    provider: ISportsProvider,
    opts: SyncOptions,
  ): Promise<Map<string, Types.ObjectId>> {
    const dtos = await provider.fetchTeams({ sport: opts.sport });
    const map = new Map<string, Types.ObjectId>();

    await withTransaction(async (session) => {
      for (const dto of dtos) {
        const entity = teamTransformer.toEntity(provider.key, dto);
        const doc = await upsertByExternalId<ITeam>(
          Team,
          provider.key,
          dto.id,
          entity,
          session,
        );
        map.set(dto.id, doc._id as Types.ObjectId);
      }
    });
    return map;
  }

  async syncPlayers(
    provider: ISportsProvider,
    opts: SyncOptions,
    teamMap?: Map<string, Types.ObjectId>,
  ): Promise<number> {
    const resolvedTeamMap = teamMap ?? (await this.syncTeams(provider, opts));
    const dtos = await provider.fetchPlayers({ sport: opts.sport });
    let count = 0;

    await withTransaction(async (session) => {
      for (const dto of dtos) {
        const entity = playerTransformer.toEntity(provider.key, dto, resolvedTeamMap);
        await upsertByExternalId<IPlayer>(Player, provider.key, dto.id, entity, session);
        count += 1;
      }
    });
    return count;
  }

  /**
   * Upserts matches and detects status transitions. Status flips emit
   * an audit-worthy row in `match_updates` so contests can react later.
   */
  async syncMatches(
    provider: ISportsProvider,
    opts: SyncOptions,
    maps?: {
      tournamentMap: Map<string, Types.ObjectId>;
      teamMap: Map<string, Types.ObjectId>;
    },
  ): Promise<{ upserted: number; statusChanged: number }> {
    let tournamentMap = maps?.tournamentMap;
    let teamMap = maps?.teamMap;
    if (!tournamentMap?.size) {
      tournamentMap = await this.syncTournaments(provider, opts);
    }
    if (!teamMap?.size) {
      teamMap = await this.syncTeams(provider, opts);
    }

    const dtos = await provider.fetchMatches({ sport: opts.sport });
    let upserted = 0;
    let statusChanged = 0;

    await withTransaction(async (session) => {
      for (const dto of dtos) {
        const entity = matchTransformer.toEntity(provider.key, dto, {
          tournamentIdMap: tournamentMap,
          teamIdMap: teamMap,
        });
        if (!entity) {
          logger.warn(
            { event: 'sports.match.skipped', dtoId: dto.id, providerKey: provider.key },
            'Match skipped — unresolved tournament/team ref',
          );
          continue;
        }

        // Read previous status for transition detection BEFORE we overwrite.
        const before = await matchRepository.findByExternalId(provider.key, dto.id);

        const doc = await upsertByExternalId<IMatch>(
          Match,
          provider.key,
          dto.id,
          entity,
          session,
        );
        upserted += 1;

        if (before && before.status !== doc.status) {
          statusChanged += 1;
          await this.recordStatusTransition(doc, before.status, provider.key, session);
        }
      }
    });

    return { upserted, statusChanged };
  }

  /**
   * Polls the provider for live-update events and appends them to the
   * `match_updates` stream. Updates the per-match score snapshot in the
   * same transaction so reads + appends stay consistent.
   */
  async syncLiveScores(opts: SyncOptions = {}): Promise<{
    eventsIngested: number;
    matchesTouched: number;
    /** PHASE 7 — internal match ids that received new events. Empty if
     *  nothing was ingested. Downstream consumers (scoring queue) use
     *  this to fan out recompute jobs without re-querying. */
    matchIds: string[];
  }> {
    const provider = this.resolveProvider(opts.provider, opts.sport);
    if (!provider.fetchLiveUpdates) {
      logger.debug(
        { provider: provider.key },
        'sports.live.skip — provider has no fetchLiveUpdates',
      );
      return { eventsIngested: 0, matchesTouched: 0, matchIds: [] };
    }

    const updates: ProviderLiveUpdateDTO[] = await provider.fetchLiveUpdates({
      sport: opts.sport,
    });
    if (!updates.length) return { eventsIngested: 0, matchesTouched: 0, matchIds: [] };

    const grouped = new Map<string, ProviderLiveUpdateDTO[]>();
    for (const u of updates) {
      const arr = grouped.get(u.matchProviderId) ?? [];
      arr.push(u);
      grouped.set(u.matchProviderId, arr);
    }

    let eventsIngested = 0;
    const matchesTouched = new Set<string>();

    await withTransaction(async (session) => {
      for (const [providerMatchId, events] of grouped.entries()) {
        const match = await matchRepository.findByExternalId(provider.key, providerMatchId);
        if (!match) continue;

        let sequence = await matchUpdateRepository.getLatestSequence(match._id, session);

        for (const ev of events) {
          sequence += 1;
          try {
            await matchUpdateRepository.create(
              {
                matchId: match._id,
                type: this.coerceUpdateType(ev.type),
                sequence,
                providerKey: provider.key,
                providerEventId: ev.eventId,
                payload: ev.payload,
                occurredAt: new Date(ev.occurredAt),
              },
              session,
            );
            eventsIngested += 1;
          } catch (err) {
            // Unique-index collisions on (matchId, providerKey, eventId)
            // are expected when the same event is replayed — swallow.
            const code = (err as { code?: number }).code;
            if (code !== 11000) throw err;
            sequence -= 1;
          }
        }

        const lastPayload = events[events.length - 1]?.payload as
          | { homeScore?: number; awayScore?: number }
          | undefined;
        if (
          lastPayload &&
          (typeof lastPayload.homeScore === 'number' ||
            typeof lastPayload.awayScore === 'number')
        ) {
          if (typeof lastPayload.homeScore === 'number' && match.scores[0]) {
            match.scores[0].score = lastPayload.homeScore;
          }
          if (typeof lastPayload.awayScore === 'number' && match.scores[1]) {
            match.scores[1].score = lastPayload.awayScore;
          }
          match.lastUpdateAt = new Date();
          await match.save({ session });
        }

        matchesTouched.add(String(match._id));
      }
    });

    if (eventsIngested > 0) {
      await sportsCacheService.flushScope('matches');
    }

    return {
      eventsIngested,
      matchesTouched: matchesTouched.size,
      matchIds: Array.from(matchesTouched),
    };
  }

  /**
   * When a match crosses a status boundary we append a STATUS event so
   * downstream listeners (sockets in Phase 8, contests in Phase 6) can
   * react without polling.
   */
  private async recordStatusTransition(
    match: HydratedDocument<IMatch>,
    previousStatus: MatchStatus,
    providerKey: string,
    session: ClientSession,
  ): Promise<void> {
    const sequence = (await matchUpdateRepository.getLatestSequence(match._id, session)) + 1;
    await matchUpdateRepository.create(
      {
        matchId: match._id,
        type: MatchUpdateType.STATUS,
        sequence,
        providerKey,
        providerEventId: `status-${previousStatus}-${match.status}-${Date.now()}`,
        payload: { from: previousStatus, to: match.status },
        occurredAt: new Date(),
      },
      session,
    );
  }

  private resolveProvider(key?: SportsProviderKey, sport: Sport = Sport.CRICKET): ISportsProvider {
    if (key) {
      const requested = sportsProviderRegistry.get(key);
      if (requested) return requested;
    }
    const resolved = sportsProviderRegistry.resolveForSport(sport);
    if (resolved) return resolved;
    const fallback = sportsProviderRegistry.list()[0];
    if (!fallback) {
      throw new Error('No sports providers registered');
    }
    return fallback;
  }

  private coerceUpdateType(raw: string): MatchUpdateType {
    if ((Object.values(MatchUpdateType) as string[]).includes(raw)) {
      return raw as MatchUpdateType;
    }
    return MatchUpdateType.GENERIC;
  }

  private async runStep<T>(
    report: SportsSyncReport,
    scope: string,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (err) {
      const message = (err as Error).message;
      report.errors.push({ scope, message });
      logger.error(
        { err, scope, provider: report.provider },
        `sports.sync.step.failed: ${scope}`,
      );
      throw err;
    }
  }

  private async audit(
    action: AuditAction,
    opts: SyncOptions,
    provider: ISportsProvider,
    errorMessage?: string,
  ): Promise<void> {
    await auditLogger.record({
      action,
      outcome: errorMessage ? auditLogger.Outcome.FAILURE : auditLogger.Outcome.SUCCESS,
      actorId: opts.actorId ?? null,
      resource: 'sports.sync',
      metadata: {
        provider: provider.key,
        source: opts.source ?? SyncSource.SCHEDULED,
        sport: opts.sport ?? 'ALL',
      },
      errorMessage,
    });
  }
}

interface SyncOptions {
  provider?: SportsProviderKey;
  sport?: Sport;
  source?: SyncSource;
  actorId?: string | null;
}

/**
 * Reusable upsert helper.
 *
 * The transformers emit a single `externalIds: [{ providerKey, id }]` row.
 * On the wire we want to:
 *  - SET every scalar field from the transformer,
 *  - $addToSet the external-id row so re-runs from the same provider
 *    don't duplicate entries AND so a second provider can later be
 *    registered without losing the first's id,
 *  - $setOnInsert nothing extra — the doc is fully described by `$set`.
 */
const upsertByExternalId = async <T extends { _id: unknown }>(
  ModelRef: Model<T>,
  providerKey: string,
  externalId: string,
  entity: Partial<T> & { externalIds?: Array<{ providerKey: string; id: string }> },
  session: ClientSession,
): Promise<HydratedDocument<T>> => {
  const { externalIds: _ignored, ...rest } = entity;
  void _ignored;
  const doc = await ModelRef.findOneAndUpdate(
    { externalIds: { $elemMatch: { providerKey, id: externalId } } },
    {
      $set: rest as Partial<T>,
      $addToSet: { externalIds: { providerKey, id: externalId } },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, session },
  ).exec();
  if (!doc) throw new Error(`Upsert failed for ${ModelRef.modelName}#${externalId}`);
  return doc as HydratedDocument<T>;
};

const createReport = (provider: SportsProviderKey): SportsSyncReport => ({
  provider,
  startedAt: new Date().toISOString(),
  completedAt: '',
  tournamentsUpserted: 0,
  teamsUpserted: 0,
  playersUpserted: 0,
  matchesUpserted: 0,
  matchesStatusChanged: 0,
  errors: [],
});

export const sportsIngestionService = new SportsIngestionService();
export { SportsIngestionService };

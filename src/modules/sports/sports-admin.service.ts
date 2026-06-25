import type { Request } from 'express';

import { logger } from '@config/logger.config';

import { AuditAction, MatchStatus, SyncSource } from '@common/enums';
import { auditLogger } from '@common/logging';
import { NotFoundError } from '@common/errors';

import { matchRepository } from './match.repository';
import { sportsCacheService } from './sports-cache.service';
import { sportsIngestionService } from './sports-ingestion.service';
import type { SportsSyncReport } from './sports.types';
import type { AdminSyncBody, AdminCacheFlushBody } from './sports.validators';

/**
 * Admin-side service for the sports module.
 *
 * Holds all the orchestration that controllers need to expose to operators:
 *  - manually trigger an ingestion run,
 *  - feature / un-feature matches,
 *  - cancel matches with a reason,
 *  - flush cache scopes.
 *
 * Audit logging is performed here so every admin action lands in
 * `audit_logs` regardless of the route layout.
 */
class SportsAdminService {
  async triggerSync(
    body: AdminSyncBody,
    req?: Request,
  ): Promise<SportsSyncReport> {
    const opts = {
      provider: body.provider,
      sport: body.sport,
      source: SyncSource.MANUAL_ADMIN,
      actorId: req?.user?.id ?? null,
    } as const;

    logger.info(
      { event: 'sports.admin.sync.trigger', mode: body.mode, ...opts },
      'Admin-triggered sports sync',
    );

    switch (body.mode) {
      case 'matches': {
        const provider = await this.requireProviderResolution(body, opts.provider);
        const { upserted, statusChanged } = await sportsIngestionService.syncMatches(
          provider,
          opts,
        );
        return this.partialReport(opts.provider, { matchesUpserted: upserted, matchesStatusChanged: statusChanged });
      }
      case 'live': {
        const provider = await this.requireProviderResolution(body, opts.provider);
        void provider;
        const { eventsIngested, matchesTouched } = await sportsIngestionService.syncLiveScores(
          opts,
        );
        return this.partialReport(opts.provider, {
          matchesUpserted: matchesTouched,
          matchesStatusChanged: eventsIngested,
        });
      }
      case 'players': {
        const provider = await this.requireProviderResolution(body, opts.provider);
        const count = await sportsIngestionService.syncPlayers(provider, opts);
        return this.partialReport(opts.provider, { playersUpserted: count });
      }
      case 'all':
      default:
        return sportsIngestionService.syncAll(opts);
    }
  }

  async setFeatured(matchId: string, isFeatured: boolean, req?: Request): Promise<void> {
    const updated = await matchRepository.setFeatured(matchId, isFeatured);
    if (!updated) throw new NotFoundError('Match');

    await sportsCacheService.invalidateMatch(matchId);
    await sportsCacheService.flushScope('matches');

    await auditLogger.record({
      action: isFeatured ? AuditAction.ADMIN_MATCH_FEATURED : AuditAction.ADMIN_MATCH_UNFEATURED,
      actorId: req?.user?.id ?? null,
      resource: 'match',
      resourceId: matchId,
      req,
    });
  }

  async cancelMatch(matchId: string, reason: string, req?: Request): Promise<void> {
    const updated = await matchRepository.updateById(matchId, {
      $set: {
        status: MatchStatus.CANCELLED,
        completedAt: new Date(),
        resultSummary: `Cancelled: ${reason}`,
      },
    });
    if (!updated) throw new NotFoundError('Match');

    await sportsCacheService.invalidateMatch(matchId);

    await auditLogger.record({
      action: AuditAction.ADMIN_MATCH_CANCELLED,
      actorId: req?.user?.id ?? null,
      resource: 'match',
      resourceId: matchId,
      metadata: { reason },
      req,
    });
  }

  async flushCache(body: AdminCacheFlushBody, req?: Request): Promise<{ deleted: number }> {
    const deleted = await sportsCacheService.flushScope(body.scope);

    await auditLogger.record({
      action: AuditAction.SPORTS_CACHE_FLUSHED,
      actorId: req?.user?.id ?? null,
      resource: 'sports.cache',
      metadata: { scope: body.scope, deleted },
      req,
    });

    return { deleted };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async requireProviderResolution(
    _body: AdminSyncBody,
    _key: string,
  ): Promise<import('./sports-provider.types').ISportsProvider> {
    // Import here to avoid a circular dep on registry → ingestion → admin.
    const { sportsProviderRegistry } = await import('./sports-provider.registry');
    const provider = _key
      ? sportsProviderRegistry.get(_key as never) ?? sportsProviderRegistry.list()[0]
      : sportsProviderRegistry.list()[0];
    if (!provider) throw new Error('No sports providers registered');
    return provider;
  }

  private partialReport(
    provider: string,
    overrides: Partial<SportsSyncReport>,
  ): SportsSyncReport {
    return {
      provider: provider as never,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      tournamentsUpserted: 0,
      teamsUpserted: 0,
      playersUpserted: 0,
      matchesUpserted: 0,
      matchesStatusChanged: 0,
      errors: [],
      ...overrides,
    };
  }
}

export const sportsAdminService = new SportsAdminService();
export { SportsAdminService };

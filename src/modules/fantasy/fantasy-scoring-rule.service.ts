import { Types } from 'mongoose';

import { logger } from '@config/logger.config';

import { ErrorCode, HttpStatus } from '@common/constants';
import {
  AuditAction,
  FantasyScoringCategory,
  FantasyScoringEventCode,
  MatchFormat,
  PlayerRole,
  Sport,
} from '@common/enums';
import { AppError, NotFoundError } from '@common/errors/AppError';
import { auditLogger } from '@common/logging';
import { withTransaction } from '@common/utils/transaction.util';

import { FantasyCacheKeys, FantasyCacheTtl, fantasyCache } from './fantasy-cache';
import { sportDefaultFormat } from './fantasy-rule.service';
import {
  FantasyScoringRule,
  type FantasyScoringRuleDoc,
  type IFantasyScoringRule,
  type IScoringEvent,
} from './fantasy-scoring-rule.model';
import { fantasyScoringRuleRepository } from './fantasy-scoring-rule.repository';
import type {
  FantasyScoringRuleCreateBody,
  FantasyScoringRuleListQuery,
  FantasyScoringRuleUpdateBody,
} from './fantasy.validators';

interface ActorCtx {
  actorId?: string | null;
  actorRoles?: string[];
}

class FantasyScoringRuleService {
  list(query: FantasyScoringRuleListQuery) {
    const { sport, format, isActive, q, page, limit, sortBy, sortOrder } = query;
    return fantasyScoringRuleRepository.list(
      { sport, format, isActive, q },
      { page, limit, sortBy, sortOrder: sortOrder ?? 'desc' },
    );
  }

  async getById(id: string): Promise<FantasyScoringRuleDoc> {
    const doc = await fantasyScoringRuleRepository.findById(id);
    if (!doc) throw new NotFoundError('Fantasy scoring rule');
    return doc;
  }

  /**
   *  Returns the active scoring rule for a sport+format.
   *
   *  Same fallback semantics as `fantasyRuleService.getActive`:
   *   1. Exact `(sport, format)`.
   *   2. `sportDefaultFormat(sport)` (cricket → T20, football → LEAGUE).
   *   3. `null`.
   */
  async getActive(sport: Sport, format: MatchFormat): Promise<FantasyScoringRuleDoc | null> {
    const key = FantasyCacheKeys.activeScoringRule(sport, format);
    const exact = await fantasyCache.wrap(key, FantasyCacheTtl.ACTIVE_SCORING_RULE, async () =>
      fantasyScoringRuleRepository.findActive(sport, format),
    );
    if (exact) return exact;

    const fallbackFormat = sportDefaultFormat(sport);
    if (!fallbackFormat || fallbackFormat === format) return null;

    const fallbackKey = FantasyCacheKeys.activeScoringRule(sport, fallbackFormat);
    return fantasyCache.wrap(fallbackKey, FantasyCacheTtl.ACTIVE_SCORING_RULE, async () =>
      fantasyScoringRuleRepository.findActive(sport, fallbackFormat),
    );
  }

  async requireActive(sport: Sport, format: MatchFormat): Promise<FantasyScoringRuleDoc> {
    const doc = await this.getActive(sport, format);
    if (!doc) {
      throw new AppError(
        `No active fantasy scoring rule configured for ${sport}/${format}`,
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.FANTASY_SCORING_RULE_NOT_FOUND,
      );
    }
    return doc;
  }

  async create(
    body: FantasyScoringRuleCreateBody,
    ctx: ActorCtx,
  ): Promise<FantasyScoringRuleDoc> {
    const created = await withTransaction(async (session) => {
      const nextVersion = await this.nextVersion(body.sport, body.format);
      if (body.setActive) {
        await fantasyScoringRuleRepository.deactivateAllActive(
          body.sport,
          body.format,
          session,
        );
      }
      const [doc] = await FantasyScoringRule.create(
        [
          {
            sport: body.sport,
            format: body.format,
            name: body.name,
            description: body.description ?? null,
            isActive: body.setActive,
            version: nextVersion,
            events: body.events as IScoringEvent[],
            createdByAdminId: ctx.actorId ? new Types.ObjectId(ctx.actorId) : null,
            updatedByAdminId: ctx.actorId ? new Types.ObjectId(ctx.actorId) : null,
          } satisfies Partial<IFantasyScoringRule>,
        ],
        { session },
      );
      return doc;
    });

    await fantasyCache.flushScope('scoring-rule');
    await this.audit(AuditAction.ADMIN_FANTASY_SCORING_CREATED, created, ctx);
    return created;
  }

  async update(
    id: string,
    body: FantasyScoringRuleUpdateBody,
    ctx: ActorCtx,
  ): Promise<FantasyScoringRuleDoc> {
    const updated = await withTransaction(async (session) => {
      const existing = await fantasyScoringRuleRepository.findById(id);
      if (!existing) throw new NotFoundError('Fantasy scoring rule');

      const willActivate = body.setActive === true && !existing.isActive;
      if (willActivate) {
        await fantasyScoringRuleRepository.deactivateAllActive(
          existing.sport,
          existing.format,
          session,
        );
      }

      const next: Partial<IFantasyScoringRule> = {
        ...body,
        description: body.description ?? existing.description,
        isActive: willActivate ? true : body.setActive === false ? false : existing.isActive,
        events: (body.events as IScoringEvent[] | undefined) ?? existing.events,
        updatedByAdminId: ctx.actorId ? new Types.ObjectId(ctx.actorId) : null,
      };
      delete (next as { setActive?: boolean }).setActive;

      const doc = await FantasyScoringRule.findByIdAndUpdate(id, { $set: next }, {
        new: true,
        session,
      }).exec();
      if (!doc) throw new NotFoundError('Fantasy scoring rule');
      return doc;
    });

    await fantasyCache.flushScope('scoring-rule');
    await this.audit(AuditAction.ADMIN_FANTASY_SCORING_UPDATED, updated, ctx);
    return updated;
  }

  async activate(id: string, ctx: ActorCtx): Promise<FantasyScoringRuleDoc> {
    const updated = await withTransaction(async (session) => {
      const existing = await fantasyScoringRuleRepository.findById(id);
      if (!existing) throw new NotFoundError('Fantasy scoring rule');
      if (existing.isActive) return existing;
      await fantasyScoringRuleRepository.deactivateAllActive(
        existing.sport,
        existing.format,
        session,
      );
      const doc = await FantasyScoringRule.findByIdAndUpdate(
        id,
        {
          $set: {
            isActive: true,
            updatedByAdminId: ctx.actorId ? new Types.ObjectId(ctx.actorId) : null,
          },
        },
        { new: true, session },
      ).exec();
      if (!doc) throw new NotFoundError('Fantasy scoring rule');
      return doc;
    });

    await fantasyCache.flushScope('scoring-rule');
    await this.audit(AuditAction.ADMIN_FANTASY_SCORING_ACTIVATED, updated, ctx);
    return updated;
  }

  private async nextVersion(sport: Sport, format: MatchFormat): Promise<number> {
    const latest = await FantasyScoringRule.findOne({ sport, format })
      .sort({ version: -1 })
      .select({ version: 1 })
      .lean()
      .exec();
    return (latest?.version ?? 0) + 1;
  }

  private async audit(
    action: AuditAction,
    doc: FantasyScoringRuleDoc,
    ctx: ActorCtx,
  ): Promise<void> {
    try {
      await auditLogger.record({
        action,
        outcome: auditLogger.Outcome.SUCCESS,
        actorId: ctx.actorId ?? null,
        actorRoles: ctx.actorRoles,
        resource: 'fantasy.scoringRule',
        resourceId: String(doc._id),
        metadata: {
          sport: doc.sport,
          format: doc.format,
          version: doc.version,
          isActive: doc.isActive,
          eventCount: doc.events.length,
        },
      });
    } catch (err) {
      logger.warn({ err, action }, 'fantasy.scoring-rule.audit.failed');
    }
  }
}

export const fantasyScoringRuleService = new FantasyScoringRuleService();

// ─── Seed ─────────────────────────────────────────────────────────────

/**
 * Default Cricket T20 scoring rule set used by the bootstrap loader the
 * first time the platform boots. Numbers chosen to mirror the typical
 * Indian fantasy-sports scoring grid so existing UX expectations hold.
 */
export const defaultCricketT20ScoringSeed: Partial<IFantasyScoringRule> = {
  sport: Sport.CRICKET,
  format: MatchFormat.T20,
  name: 'Cricket T20 — Default scoring',
  description: 'Default Cricket T20 fantasy scoring rules',
  isActive: true,
  version: 1,
  events: [
    {
      code: FantasyScoringEventCode.BATTING_RUN,
      category: FantasyScoringCategory.BATTING,
      label: 'Run scored',
      statKey: 'runs',
      points: 1,
      threshold: null,
      unit: null,
      appliesTo: [],
      sortOrder: 1,
    },
    {
      code: FantasyScoringEventCode.BATTING_BOUNDARY,
      category: FantasyScoringCategory.BATTING,
      label: 'Boundary bonus',
      statKey: 'fours',
      points: 1,
      threshold: null,
      unit: null,
      appliesTo: [],
      sortOrder: 2,
    },
    {
      code: FantasyScoringEventCode.BATTING_SIX,
      category: FantasyScoringCategory.BATTING,
      label: 'Six bonus',
      statKey: 'sixes',
      points: 2,
      threshold: null,
      unit: null,
      appliesTo: [],
      sortOrder: 3,
    },
    {
      code: FantasyScoringEventCode.BATTING_FIFTY,
      category: FantasyScoringCategory.BATTING,
      label: 'Half-century bonus',
      statKey: 'runs',
      points: 8,
      threshold: 50,
      unit: null,
      appliesTo: [],
      sortOrder: 4,
    },
    {
      code: FantasyScoringEventCode.BATTING_HUNDRED,
      category: FantasyScoringCategory.BATTING,
      label: 'Century bonus',
      statKey: 'runs',
      points: 16,
      threshold: 100,
      unit: null,
      appliesTo: [],
      sortOrder: 5,
    },
    {
      code: FantasyScoringEventCode.BATTING_DUCK,
      category: FantasyScoringCategory.PENALTY,
      label: 'Dismissed for a duck',
      statKey: 'duck',
      points: -2,
      threshold: 1,
      unit: null,
      appliesTo: [PlayerRole.BATSMAN, PlayerRole.WICKET_KEEPER, PlayerRole.ALL_ROUNDER],
      sortOrder: 6,
    },
    {
      code: FantasyScoringEventCode.BOWLING_WICKET,
      category: FantasyScoringCategory.BOWLING,
      label: 'Wicket',
      statKey: 'wickets',
      points: 25,
      threshold: null,
      unit: null,
      appliesTo: [],
      sortOrder: 7,
    },
    {
      code: FantasyScoringEventCode.BOWLING_MAIDEN,
      category: FantasyScoringCategory.BOWLING,
      label: 'Maiden over',
      statKey: 'maidens',
      points: 12,
      threshold: null,
      unit: null,
      appliesTo: [],
      sortOrder: 8,
    },
    {
      code: FantasyScoringEventCode.BOWLING_THREE_WKT_HAUL,
      category: FantasyScoringCategory.BOWLING,
      label: '3-wicket haul',
      statKey: 'wickets',
      points: 4,
      threshold: 3,
      unit: null,
      appliesTo: [],
      sortOrder: 9,
    },
    {
      code: FantasyScoringEventCode.BOWLING_FIVE_WKT_HAUL,
      category: FantasyScoringCategory.BOWLING,
      label: '5-wicket haul',
      statKey: 'wickets',
      points: 16,
      threshold: 5,
      unit: null,
      appliesTo: [],
      sortOrder: 10,
    },
    {
      code: FantasyScoringEventCode.FIELDING_CATCH,
      category: FantasyScoringCategory.FIELDING,
      label: 'Catch',
      statKey: 'catches',
      points: 8,
      threshold: null,
      unit: null,
      appliesTo: [],
      sortOrder: 11,
    },
    {
      code: FantasyScoringEventCode.FIELDING_STUMPING,
      category: FantasyScoringCategory.FIELDING,
      label: 'Stumping',
      statKey: 'stumpings',
      points: 12,
      threshold: null,
      unit: null,
      appliesTo: [PlayerRole.WICKET_KEEPER],
      sortOrder: 12,
    },
    {
      code: FantasyScoringEventCode.FIELDING_RUN_OUT_DIRECT,
      category: FantasyScoringCategory.FIELDING,
      label: 'Direct run-out',
      statKey: 'runOutsDirect',
      points: 12,
      threshold: null,
      unit: null,
      appliesTo: [],
      sortOrder: 13,
    },
    {
      code: FantasyScoringEventCode.FIELDING_RUN_OUT_ASSIST,
      category: FantasyScoringCategory.FIELDING,
      label: 'Run-out assist',
      statKey: 'runOutsAssist',
      points: 6,
      threshold: null,
      unit: null,
      appliesTo: [],
      sortOrder: 14,
    },
    {
      code: FantasyScoringEventCode.BONUS_PLAYER_OF_MATCH,
      category: FantasyScoringCategory.BONUS,
      label: 'Player of the match',
      statKey: 'playerOfMatch',
      points: 10,
      threshold: 1,
      unit: null,
      appliesTo: [],
      sortOrder: 15,
    },
    {
      code: FantasyScoringEventCode.BONUS_IN_PLAYING_XI,
      category: FantasyScoringCategory.BONUS,
      label: 'Played the match',
      statKey: 'playedMatch',
      points: 4,
      threshold: 1,
      unit: null,
      appliesTo: [],
      sortOrder: 16,
    },
  ],
};

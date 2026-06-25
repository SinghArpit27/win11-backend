import { Types } from 'mongoose';

import { logger } from '@config/logger.config';

import { AppConstants, ErrorCode } from '@common/constants';
import {
  AuditAction,
  MatchFormat,
  PlayerRole,
  Sport,
} from '@common/enums';
import { AppError, NotFoundError } from '@common/errors/AppError';
import { auditLogger } from '@common/logging';
import { HttpStatus } from '@common/constants';
import { withTransaction } from '@common/utils/transaction.util';

import { FantasyCacheKeys, FantasyCacheTtl, fantasyCache } from './fantasy-cache';
import {
  FantasyRule,
  type FantasyRuleDoc,
  type IFantasyRule,
  type IRoleConstraint,
} from './fantasy-rule.model';
import { fantasyRuleRepository } from './fantasy-rule.repository';
import type {
  FantasyRuleCreateBody,
  FantasyRuleListQuery,
  FantasyRuleUpdateBody,
} from './fantasy.validators';

interface FantasyRuleActorContext {
  actorId?: string | null;
  actorRoles?: string[];
}

/**
 * Service for managing the configurable `fantasy_rules` collection.
 *
 * Read methods serve cached lookups (Redis-backed); write methods are
 * transactional and invalidate the cache + emit an audit log entry.
 *
 * One `isActive` row per (sport, format) is enforced via:
 *  - a partial unique index at the DB layer (defence in depth), AND
 *  - a `deactivateAllActive(...)` sweep inside this service so admins
 *    can flip the active rule in a single API call without race-window
 *    failures from the partial index.
 */
class FantasyRuleService {
  list(query: FantasyRuleListQuery) {
    const { sport, format, isActive, q, page, limit, sortBy, sortOrder } = query;
    return fantasyRuleRepository.list(
      { sport, format, isActive, q },
      { page, limit, sortBy, sortOrder: sortOrder ?? 'desc' },
    );
  }

  async getById(id: string): Promise<FantasyRuleDoc> {
    const rule = await fantasyRuleRepository.findById(id);
    if (!rule) throw new NotFoundError('Fantasy rule');
    return rule;
  }

  /**
   * Returns the active rule for a sport+format. Read-through Redis cache.
   *
   *  Fallback chain:
   *   1. Exact `(sport, format)` match.
   *   2. Sport-wide default — for `CRICKET` we fall back to `T20`,
   *      for `FOOTBALL` we fall back to `LEAGUE`. This protects the
   *      create-team UI from breaking when an admin deletes the
   *      format-specific rule but the sport-default still exists.
   *   3. `null` — caller decides whether that's an error
   *      (`FANTASY_RULES_NOT_CONFIGURED`).
   */
  async getActive(sport: Sport, format: MatchFormat): Promise<FantasyRuleDoc | null> {
    const key = FantasyCacheKeys.activeRule(sport, format);
    const exact = await fantasyCache.wrap(key, FantasyCacheTtl.ACTIVE_RULE, async () =>
      fantasyRuleRepository.findActive(sport, format),
    );
    if (exact) return exact;

    const fallbackFormat = sportDefaultFormat(sport);
    if (!fallbackFormat || fallbackFormat === format) return null;

    const fallbackKey = FantasyCacheKeys.activeRule(sport, fallbackFormat);
    return fantasyCache.wrap(fallbackKey, FantasyCacheTtl.ACTIVE_RULE, async () =>
      fantasyRuleRepository.findActive(sport, fallbackFormat),
    );
  }

  /**
   * Same as `getActive` but throws when no rule has been configured.
   * Used by team/draft services that cannot proceed without a rule.
   */
  async requireActive(sport: Sport, format: MatchFormat): Promise<FantasyRuleDoc> {
    const rule = await this.getActive(sport, format);
    if (!rule) {
      throw new AppError(
        `No active fantasy rule configured for ${sport}/${format}`,
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.FANTASY_RULES_NOT_CONFIGURED,
      );
    }
    return rule;
  }

  async create(body: FantasyRuleCreateBody, ctx: FantasyRuleActorContext): Promise<FantasyRuleDoc> {
    const created = await withTransaction(async (session) => {
      const nextVersion = await this.nextVersion(body.sport, body.format);
      if (body.setActive) {
        await fantasyRuleRepository.deactivateAllActive(body.sport, body.format, session);
      }
      const [doc] = await FantasyRule.create(
        [
          {
            ...body,
            description: body.description ?? null,
            isActive: body.setActive,
            version: nextVersion,
            createdByAdminId: ctx.actorId ? new Types.ObjectId(ctx.actorId) : null,
            updatedByAdminId: ctx.actorId ? new Types.ObjectId(ctx.actorId) : null,
          } satisfies Partial<IFantasyRule> & {
            roleConstraints: IRoleConstraint[];
          },
        ],
        { session },
      );
      return doc;
    });

    await fantasyCache.flushScope('rule');
    await this.auditWrite(AuditAction.ADMIN_FANTASY_RULE_CREATED, created, ctx);
    return created;
  }

  async update(
    id: string,
    body: FantasyRuleUpdateBody,
    ctx: FantasyRuleActorContext,
  ): Promise<FantasyRuleDoc> {
    const updated = await withTransaction(async (session) => {
      const existing = await fantasyRuleRepository.findById(id);
      if (!existing) throw new NotFoundError('Fantasy rule');

      // If admin requested activation, flip the active flag exclusively.
      const willActivate = body.setActive === true && !existing.isActive;
      if (willActivate) {
        await fantasyRuleRepository.deactivateAllActive(existing.sport, existing.format, session);
      }

      const next: Partial<IFantasyRule> = {
        ...body,
        description: body.description ?? existing.description,
        isActive: willActivate ? true : (body.setActive === false ? false : existing.isActive),
        updatedByAdminId: ctx.actorId ? new Types.ObjectId(ctx.actorId) : null,
      };
      // The user-supplied `setActive` is *intent* — we never store it.
      delete (next as { setActive?: boolean }).setActive;

      const doc = await FantasyRule.findByIdAndUpdate(id, { $set: next }, {
        new: true,
        session,
      }).exec();
      if (!doc) throw new NotFoundError('Fantasy rule');
      return doc;
    });

    await fantasyCache.flushScope('rule');
    await this.auditWrite(AuditAction.ADMIN_FANTASY_RULE_UPDATED, updated, ctx);
    return updated;
  }

  async activate(id: string, ctx: FantasyRuleActorContext): Promise<FantasyRuleDoc> {
    const updated = await withTransaction(async (session) => {
      const existing = await fantasyRuleRepository.findById(id);
      if (!existing) throw new NotFoundError('Fantasy rule');
      if (existing.isActive) return existing;
      await fantasyRuleRepository.deactivateAllActive(existing.sport, existing.format, session);
      const doc = await FantasyRule.findByIdAndUpdate(
        id,
        {
          $set: {
            isActive: true,
            updatedByAdminId: ctx.actorId ? new Types.ObjectId(ctx.actorId) : null,
          },
        },
        { new: true, session },
      ).exec();
      if (!doc) throw new NotFoundError('Fantasy rule');
      return doc;
    });

    await fantasyCache.flushScope('rule');
    await this.auditWrite(AuditAction.ADMIN_FANTASY_RULE_ACTIVATED, updated, ctx);
    return updated;
  }

  private async nextVersion(sport: Sport, format: MatchFormat): Promise<number> {
    const latest = await FantasyRule.findOne({ sport, format })
      .sort({ version: -1 })
      .select({ version: 1 })
      .lean()
      .exec();
    return (latest?.version ?? 0) + 1;
  }

  private async auditWrite(
    action: AuditAction,
    doc: FantasyRuleDoc,
    ctx: FantasyRuleActorContext,
  ): Promise<void> {
    try {
      await auditLogger.record({
        action,
        outcome: auditLogger.Outcome.SUCCESS,
        actorId: ctx.actorId ?? null,
        actorRoles: ctx.actorRoles,
        resource: 'fantasy.rule',
        resourceId: String(doc._id),
        metadata: {
          sport: doc.sport,
          format: doc.format,
          version: doc.version,
          isActive: doc.isActive,
        },
      });
    } catch (err) {
      logger.warn({ err, action }, 'fantasy.rule.audit.failed');
    }
  }
}

export const fantasyRuleService = new FantasyRuleService();

/**
 * Sport → default fantasy format used by the rule fallback. Centralised
 * here so the same mapping powers `getActive` (rule) and
 * `fantasyScoringRuleService.getActive` (scoring).
 */
export const sportDefaultFormat = (sport: Sport): MatchFormat | null => {
  switch (sport) {
    case Sport.CRICKET:
      return MatchFormat.T20;
    case Sport.FOOTBALL:
    case Sport.BASKETBALL:
    case Sport.KABADDI:
      return MatchFormat.LEAGUE;
    default:
      return null;
  }
};

// Seed builder — exported so the bootstrap loader can pre-populate sensible
// defaults the first time the platform boots in a fresh environment.
export const defaultCricketT20RuleSeed: Partial<IFantasyRule> = {
  sport: Sport.CRICKET,
  format: MatchFormat.T20,
  name: 'Cricket T20 — Default',
  description: 'Default Cricket T20 fantasy team-building rules',
  isActive: true,
  teamSize: AppConstants.FANTASY.DEFAULT_TEAM_SIZE,
  creditBudget: AppConstants.FANTASY.DEFAULT_CREDIT_BUDGET,
  minPerPlayerCredits: 6,
  maxPerPlayerCredits: 12,
  minFromSingleTeam: AppConstants.FANTASY.DEFAULT_MIN_FROM_SINGLE_TEAM,
  maxFromSingleTeam: AppConstants.FANTASY.DEFAULT_MAX_FROM_SINGLE_TEAM,
  roleConstraints: [
    { role: PlayerRole.WICKET_KEEPER, min: 1, max: 4 },
    { role: PlayerRole.BATSMAN, min: 3, max: 6 },
    { role: PlayerRole.ALL_ROUNDER, min: 1, max: 4 },
    { role: PlayerRole.BOWLER, min: 3, max: 6 },
  ],
  captainMultiplier: AppConstants.FANTASY.DEFAULT_CAPTAIN_MULTIPLIER,
  viceCaptainMultiplier: AppConstants.FANTASY.DEFAULT_VICE_CAPTAIN_MULTIPLIER,
  maxTeamsPerUserPerMatch: AppConstants.FANTASY.DEFAULT_MAX_TEAMS_PER_USER_PER_MATCH,
  warnAtTeamsPerUserPerMatch: 15,
  version: 1,
};

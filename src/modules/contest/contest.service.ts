import type { Request } from 'express';
import { Types, type ClientSession } from 'mongoose';

import { AppConstants, ErrorCode, HttpStatus } from '@common/constants';
import {
  AuditAction,
  ContestStatus,
  ContestType,
  ContestVisibility,
  PrizeDistributionType,
} from '@common/enums';
import { AppError, NotFoundError } from '@common/errors';
import { auditLogger } from '@common/logging';
import { withTransaction } from '@common/utils/transaction.util';

import { Match, type MatchDoc } from '@modules/sports/match.model';

import { BaseService } from '@shared/services/base.service';

import {
  Contest,
  type ContestDoc,
  type IContestPrizeSlabSnapshot,
  type IContestPrizeSnapshot,
} from './contest.model';
import { contestCache } from './contest-cache';
import { contestRepository } from './contest.repository';
import type {
  AdminContestCreateBody,
  AdminContestListQuery,
  AdminContestUpdateBody,
  ContestCloneBody,
  ContestListQuery,
} from './contest.validators';
import { contestEntryRepository } from './contest-entry.repository';
import { prizeDistributionService } from './prize-distribution.service';

/**
 * `contest.service.ts` — admin + user contest lifecycle.
 *
 *  Responsibilities:
 *   - Spawning contests from templates and inline blueprints.
 *   - Cloning a contest (1..N) with new names + match bindings.
 *   - Status transitions (publish, lock, live, complete, cancel).
 *   - Cancellation → triggers refund sweep through `contest-join.service`.
 *
 *  The **join engine** lives in `contest-join.service.ts` — kept distinct
 *  because joins have a different concurrency profile (per-request
 *  transaction + wallet calls) than admin-side mutations.
 */
class ContestService extends BaseService {
  /** Status transitions allowed without admin override. */
  private readonly ALLOWED_TRANSITIONS: Readonly<Record<ContestStatus, readonly ContestStatus[]>> = {
    [ContestStatus.DRAFT]: [ContestStatus.SCHEDULED, ContestStatus.OPEN, ContestStatus.CANCELLED],
    [ContestStatus.SCHEDULED]: [ContestStatus.OPEN, ContestStatus.CANCELLED],
    [ContestStatus.OPEN]: [
      ContestStatus.FULL,
      ContestStatus.LOCKED,
      ContestStatus.LIVE,
      ContestStatus.CANCELLED,
    ],
    [ContestStatus.FULL]: [ContestStatus.LOCKED, ContestStatus.LIVE, ContestStatus.CANCELLED],
    [ContestStatus.LOCKED]: [ContestStatus.LIVE, ContestStatus.COMPLETED, ContestStatus.CANCELLED],
    [ContestStatus.LIVE]: [ContestStatus.COMPLETED, ContestStatus.CANCELLED],
    [ContestStatus.COMPLETED]: [],
    [ContestStatus.CANCELLED]: [],
  };

  constructor() {
    super('contest-service');
  }

  // ───────────────────────────────────────────────── User reads ─────────

  listForUser(query: ContestListQuery) {
    const { matchId, type, status, minEntryFee, maxEntryFee, hideFull, q, page, limit, sortBy, sortOrder } = query;
    return contestRepository.list(
      {
        matchId,
        type,
        status,
        minEntryFee,
        maxEntryFee,
        hideFull,
        q,
        includePrivate: false,
      },
      { page, limit, sortBy, sortOrder: sortOrder ?? 'desc' },
    );
  }

  listForAdmin(query: AdminContestListQuery) {
    const { matchId, type, visibility, status, q, page, limit, sortBy, sortOrder } = query;
    return contestRepository.list(
      { matchId, type, visibility, status, q, includePrivate: true },
      { page, limit, sortBy, sortOrder: sortOrder ?? 'desc' },
    );
  }

  async getById(id: string): Promise<ContestDoc> {
    const doc = await contestRepository.findByIdActive(id);
    if (!doc) {
      throw new AppError('Contest not found', HttpStatus.NOT_FOUND, ErrorCode.CONTEST_NOT_FOUND);
    }
    return doc;
  }

  async getByInviteCode(code: string): Promise<ContestDoc> {
    const doc = await contestRepository.findByInviteCode(code);
    if (!doc) {
      throw new AppError(
        'Contest not found for this invite code',
        HttpStatus.NOT_FOUND,
        ErrorCode.CONTEST_INVITE_CODE_INVALID,
      );
    }
    return doc;
  }

  // ────────────────────────────────────────────────── Admin writes ───────

  async createContest(
    body: AdminContestCreateBody,
    actor: { id: string | null; roles?: string[]; req?: Request },
  ): Promise<ContestDoc> {
    const match = await Match.findById(body.matchId).exec();
    if (!match) {
      throw new AppError('Match not found', HttpStatus.NOT_FOUND, ErrorCode.MATCH_NOT_FOUND);
    }

    const prizeSnapshot = await this.buildPrizeSnapshot({
      prizeDistributionId: body.prizeDistributionId ?? null,
      prize: body.prize ?? null,
      poolAmount: body.prizePoolAmount,
      type: body.type,
      entryFee: body.entryFee,
    });

    const initialStatus =
      body.publishImmediately === true ? ContestStatus.OPEN : ContestStatus.DRAFT;
    const inviteCode =
      body.visibility === ContestVisibility.PRIVATE || body.inviteCode
        ? this.normaliseInviteCode(body.inviteCode) ?? this.generateInviteCode()
        : null;

    const doc = await contestRepository.create({
      matchId: match._id,
      sport: match.sport,
      format: match.format,
      name: body.name,
      description: body.description ?? null,
      type: body.type,
      visibility: body.visibility,
      inviteCode,
      status: initialStatus,
      publishedAt: initialStatus === ContestStatus.OPEN ? new Date() : null,
      joinOpensAt: body.joinOpensAt ? new Date(body.joinOpensAt) : null,
      joinClosesAt: body.joinClosesAt
        ? new Date(body.joinClosesAt)
        : match.lineupLockedAt ?? null,
      cancelledAt: null,
      cancellationReason: null,
      isPractice: body.isPractice,
      isGuaranteed: body.isGuaranteed,
      entryFee: body.entryFee,
      prizePoolAmount: body.prizePoolAmount,
      currency: body.currency,
      totalSpots: body.totalSpots,
      filledSpots: 0,
      maxEntriesPerUser: body.maxEntriesPerUser,
      prizeSnapshot,
      templateId: body.templateId ? new Types.ObjectId(body.templateId) : null,
      clonedFromId: null,
      createdBy: actor.id ? new Types.ObjectId(actor.id) : null,
      updatedBy: actor.id ? new Types.ObjectId(actor.id) : null,
      cancelledBy: null,
      version: 0,
      lastJoinedAt: null,
      distinctParticipantsCount: 0,
    });

    await auditLogger.success({
      action: AuditAction.CONTEST_CREATED,
      actorId: actor.id,
      actorRoles: actor.roles,
      resource: 'contest',
      resourceId: String(doc._id),
      metadata: {
        type: doc.type,
        matchId: String(doc.matchId),
        spots: doc.totalSpots,
        entryFee: doc.entryFee,
      },
      req: actor.req,
    });

    await contestCache.invalidateContest(String(doc._id), String(doc.matchId));
    return doc;
  }

  async updateContest(
    id: string,
    body: AdminContestUpdateBody,
    actor: { id: string | null; roles?: string[]; req?: Request },
  ): Promise<ContestDoc> {
    const existing = await this.getById(id);

    // Guard: editable fields after publish are limited; capacity can only
    // *grow*. Reducing capacity below `filledSpots` would orphan entries.
    if (body.totalSpots !== undefined && body.totalSpots < existing.filledSpots) {
      throw new AppError(
        '`totalSpots` cannot be reduced below the current fill count',
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
      );
    }

    const updated = await contestRepository.updateById(id, {
      $set: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.visibility !== undefined && { visibility: body.visibility }),
        ...(body.totalSpots !== undefined && { totalSpots: body.totalSpots }),
        ...(body.maxEntriesPerUser !== undefined && {
          maxEntriesPerUser: body.maxEntriesPerUser,
        }),
        ...(body.prizePoolAmount !== undefined && { prizePoolAmount: body.prizePoolAmount }),
        ...(body.isGuaranteed !== undefined && { isGuaranteed: body.isGuaranteed }),
        ...(body.joinOpensAt !== undefined && {
          joinOpensAt: body.joinOpensAt ? new Date(body.joinOpensAt) : null,
        }),
        ...(body.joinClosesAt !== undefined && {
          joinClosesAt: body.joinClosesAt ? new Date(body.joinClosesAt) : null,
        }),
        updatedBy: actor.id ? new Types.ObjectId(actor.id) : null,
      },
      $inc: { version: 1 },
    });
    if (!updated) throw new NotFoundError('Contest');

    await auditLogger.success({
      action: AuditAction.CONTEST_UPDATED,
      actorId: actor.id,
      actorRoles: actor.roles,
      resource: 'contest',
      resourceId: id,
      metadata: { previousVersion: existing.version, newVersion: updated.version },
      req: actor.req,
    });

    await contestCache.invalidateContest(id, String(updated.matchId));
    return updated;
  }

  /**
   * Cancels a contest and refunds every active entry. The refund loop
   * is delegated to the join service so the wallet wiring + audit
   * trail stay in one place.
   */
  async cancelContest(
    id: string,
    reason: string,
    actor: { id: string | null; roles?: string[]; req?: Request },
    refundFn: (entries: Array<{ id: string; userId: string; amount: number; currency: string }>, contestId: string) => Promise<void>,
  ): Promise<ContestDoc> {
    const existing = await this.getById(id);
    if (existing.status === ContestStatus.CANCELLED) return existing;
    if (existing.status === ContestStatus.COMPLETED) {
      throw new AppError(
        'Completed contests cannot be cancelled',
        HttpStatus.BAD_REQUEST,
        ErrorCode.CONTEST_INVALID_STATUS_TRANSITION,
      );
    }

    const cancelled = await withTransaction(async (session) => {
      const flipped = await contestRepository.setStatus(id, ContestStatus.CANCELLED, {
        expectedStatuses: this.cancellableStatuses(),
        patch: {
          $set: {
            cancelledAt: new Date(),
            cancellationReason: reason,
            cancelledBy: actor.id ? new Types.ObjectId(actor.id) : null,
          },
        },
        session,
      });
      if (!flipped) {
        throw new AppError(
          'Contest could not be cancelled (status changed under us)',
          HttpStatus.CONFLICT,
          ErrorCode.CONTEST_INVALID_STATUS_TRANSITION,
        );
      }
      return flipped;
    });

    // Refund loop runs OUTSIDE the txn — each refund is its own
    // transaction; this avoids one long-running session locking the
    // contest row for the entire refund window.
    const activeEntries = await contestEntryRepository.findActiveForContest(id);
    if (activeEntries.length > 0) {
      const refundList = activeEntries.map((e) => ({
        id: String(e._id),
        userId: String(e.userId),
        amount: e.entryFee,
        currency: e.currency,
      }));
      try {
        await refundFn(refundList, id);
      } catch (err) {
        this.logger.error({ err, contestId: id }, 'contest.cancel.refund.failed');
        // We do NOT rollback the cancellation — refund failures are
        // surfaced via audit + alerting and re-tried by the
        // reconciliation worker.
      }
    }

    await auditLogger.success({
      action: AuditAction.CONTEST_CANCELLED,
      actorId: actor.id,
      actorRoles: actor.roles,
      resource: 'contest',
      resourceId: id,
      metadata: {
        reason,
        refundedEntries: activeEntries.length,
        previousStatus: existing.status,
      },
      req: actor.req,
    });

    await contestCache.invalidateContest(id, String(cancelled.matchId));
    return cancelled;
  }

  /** Admin status transitions. Validates the transition map. */
  async transitionStatus(
    id: string,
    target: ContestStatus,
    actor: { id: string | null; roles?: string[]; req?: Request },
  ): Promise<ContestDoc> {
    const existing = await this.getById(id);
    const allowed = this.ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(target)) {
      throw new AppError(
        `Cannot transition from ${existing.status} → ${target}`,
        HttpStatus.BAD_REQUEST,
        ErrorCode.CONTEST_INVALID_STATUS_TRANSITION,
      );
    }
    const updated = await contestRepository.setStatus(id, target, {
      expectedStatuses: [existing.status],
      patch: target === ContestStatus.OPEN ? { $set: { publishedAt: new Date() } } : {},
    });
    if (!updated) throw new NotFoundError('Contest');

    await auditLogger.success({
      action: AuditAction.CONTEST_STATUS_TRANSITIONED,
      actorId: actor.id,
      actorRoles: actor.roles,
      resource: 'contest',
      resourceId: id,
      metadata: { from: existing.status, to: target },
      req: actor.req,
    });

    await contestCache.invalidateContest(id, String(updated.matchId));
    return updated;
  }

  /**
   * Clones one contest into N new contests on either the same match or
   * a different match. Each clone gets a fresh status (DRAFT) and a
   * fresh `lastJoinedAt` / `filledSpots` of 0.
   */
  async cloneContest(
    sourceId: string,
    body: ContestCloneBody,
    actor: { id: string | null; roles?: string[]; req?: Request },
  ): Promise<ContestDoc[]> {
    const source = await this.getById(sourceId);
    const targetMatchId = body.matchId
      ? new Types.ObjectId(body.matchId)
      : source.matchId;
    const match = body.matchId ? await Match.findById(body.matchId).exec() : null;

    if (body.matchId && !match) {
      throw new AppError('Target match not found', HttpStatus.NOT_FOUND, ErrorCode.MATCH_NOT_FOUND);
    }

    const baseName = body.name ?? source.name;
    const created: ContestDoc[] = [];

    for (let i = 1; i <= body.count; i++) {
      const cloneDoc = await contestRepository.create({
        matchId: targetMatchId,
        sport: match?.sport ?? source.sport,
        format: match?.format ?? source.format,
        name: body.count === 1 ? baseName : `${baseName} #${i}`,
        description: source.description ?? null,
        type: source.type,
        visibility: source.visibility,
        inviteCode:
          source.visibility === ContestVisibility.PRIVATE
            ? this.generateInviteCode()
            : null,
        status: ContestStatus.DRAFT,
        publishedAt: null,
        joinOpensAt: source.joinOpensAt,
        joinClosesAt: source.joinClosesAt,
        cancelledAt: null,
        cancellationReason: null,
        isPractice: source.isPractice,
        isGuaranteed: source.isGuaranteed,
        entryFee: source.entryFee,
        prizePoolAmount: source.prizePoolAmount,
        currency: source.currency,
        totalSpots: source.totalSpots,
        filledSpots: 0,
        maxEntriesPerUser: source.maxEntriesPerUser,
        prizeSnapshot: source.prizeSnapshot,
        templateId: source.templateId,
        clonedFromId: source._id,
        createdBy: actor.id ? new Types.ObjectId(actor.id) : null,
        updatedBy: actor.id ? new Types.ObjectId(actor.id) : null,
        cancelledBy: null,
        version: 0,
        lastJoinedAt: null,
        distinctParticipantsCount: 0,
      });
      created.push(cloneDoc);
    }

    await auditLogger.success({
      action: AuditAction.CONTEST_CLONED,
      actorId: actor.id,
      actorRoles: actor.roles,
      resource: 'contest',
      resourceId: sourceId,
      metadata: {
        clones: created.map((c) => String(c._id)),
        count: body.count,
        targetMatchId: String(targetMatchId),
      },
      req: actor.req,
    });

    await contestCache.invalidateContest(sourceId, String(source.matchId));
    return created;
  }

  // ───────────────────────────────────── Internal helpers / mappers ─────

  /**
   * Builds the embedded prize snapshot from either a saved distribution
   * template OR an inline slabs array. Validates the result against
   * the contest's prize pool so admins can't ship a misconfigured one.
   */
  async buildPrizeSnapshot(input: {
    prizeDistributionId: string | null;
    prize: { type: PrizeDistributionType; slabs: AdminContestCreateBody['prize'] extends infer P
      ? P extends { slabs: infer S }
        ? S
        : never
      : never } | null;
    poolAmount: number;
    type: ContestType;
    entryFee: number;
  }): Promise<IContestPrizeSnapshot> {
    if (input.entryFee === 0 && input.poolAmount === 0 && input.type === ContestType.PRACTICE) {
      // Practice contests can ship without a real prize structure — we
      // still need at least one slab so the validator + serializer
      // don't choke. Use a `prizeAmount: 0` rank-1 slab.
      return {
        distributionId: null,
        name: 'Practice — No prize',
        type: PrizeDistributionType.FIXED,
        poolAmount: 0,
        maxWinningRank: 1,
        slabs: [{ fromRank: 1, toRank: 1, prizeAmount: 0, percentageBps: 0, bonusLabel: null }],
      };
    }

    if (input.prizeDistributionId) {
      const dist = await prizeDistributionService.getById(input.prizeDistributionId);
      // Adapt the slabs to the contest pool — for PERCENTAGE_BASED, the
      // slabs are pool-agnostic. For RANK_BASED / FIXED we must re-validate
      // against the actual contest pool.
      const adapted = dist.slabs.map<IContestPrizeSlabSnapshot>((s) => ({
        fromRank: s.fromRank,
        toRank: s.toRank,
        prizeAmount: s.prizeAmount,
        percentageBps: s.percentageBps,
        bonusLabel: s.bonusLabel ?? null,
      }));
      prizeDistributionService.assertValidSlabs(
        adapted,
        dist.type,
        dist.type === PrizeDistributionType.PERCENTAGE_BASED ? null : input.poolAmount,
      );
      return {
        distributionId: dist._id,
        name: dist.name,
        type: dist.type,
        poolAmount: input.poolAmount,
        maxWinningRank: dist.maxWinningRank,
        slabs: adapted,
      };
    }

    if (input.prize) {
      prizeDistributionService.assertValidSlabs(
        input.prize.slabs,
        input.prize.type,
        input.prize.type === PrizeDistributionType.PERCENTAGE_BASED ? null : input.poolAmount,
      );
      const max = input.prize.slabs.reduce((m, s) => Math.max(m, s.toRank), 0);
      return {
        distributionId: null,
        name: 'Custom',
        type: input.prize.type,
        poolAmount: input.poolAmount,
        maxWinningRank: max,
        slabs: input.prize.slabs.map<IContestPrizeSlabSnapshot>((s) => ({
          fromRank: s.fromRank,
          toRank: s.toRank,
          prizeAmount: s.prizeAmount ?? 0,
          percentageBps: s.percentageBps ?? 0,
          bonusLabel: s.bonusLabel ?? null,
        })),
      };
    }

    throw new AppError(
      'A `prizeDistributionId` or inline `prize` block is required',
      HttpStatus.BAD_REQUEST,
      ErrorCode.PRIZE_DISTRIBUTION_INVALID,
    );
  }

  /**
   * Internal: deterministic transition target for the auto-LOCK job
   * (Phase 6 has no scheduler yet — the join engine flips contests to
   * FULL inline, and admins flip to LOCKED/LIVE for now).
   */
  cancellableStatuses(): ContestStatus[] {
    return [
      ContestStatus.DRAFT,
      ContestStatus.SCHEDULED,
      ContestStatus.OPEN,
      ContestStatus.FULL,
      ContestStatus.LOCKED,
      ContestStatus.LIVE,
    ];
  }

  /**
   * Marks a contest as FULL if it reached capacity. Called by the join
   * service inside its txn so the flip is atomic with the entry insert.
   */
  async markFullIfCapacityReached(
    contestId: string,
    session: ClientSession,
  ): Promise<ContestDoc | null> {
    const result = await Contest.findOneAndUpdate(
      {
        _id: contestId,
        status: ContestStatus.OPEN,
        $expr: { $gte: ['$filledSpots', '$totalSpots'] },
      },
      {
        $set: { status: ContestStatus.FULL },
        $inc: { version: 1 },
      },
      { new: true, session },
    ).exec();
    return result;
  }

  /** Refresh the denormalised distinct-participant counter. Used by the
   *  join engine after a successful join. Best-effort, non-fatal. */
  async refreshDistinctParticipants(contestId: string): Promise<void> {
    try {
      const count = await contestEntryRepository.distinctParticipantCount(contestId);
      await contestRepository.updateById(contestId, {
        $set: { distinctParticipantsCount: count },
      });
    } catch (err) {
      this.logger.warn({ err, contestId }, 'contest.distinct_count.refresh.failed');
    }
  }

  /** Pre-load the host match for serializer hydration (avoids per-contest fetches). */
  async loadMatches(matchIds: Types.ObjectId[]): Promise<Map<string, MatchDoc>> {
    if (matchIds.length === 0) return new Map();
    const unique = Array.from(new Set(matchIds.map(String)));
    const matches = await Match.find({ _id: { $in: unique } }).exec();
    return new Map(matches.map((m) => [String(m._id), m]));
  }

  private normaliseInviteCode(code: string | null | undefined): string | null {
    if (!code) return null;
    const clean = code.trim().toUpperCase();
    return clean.length >= 3 ? clean : null;
  }

  /**
   * Generates a short alphanumeric invite code. Unambiguous alphabet
   * (no 0/O/I/1) so users typing it on a small screen don't fat-finger.
   * Collisions are extremely unlikely (32^6 = ~1B), but the schema
   * carries a sparse unique index as a guard.
   */
  private generateInviteCode(): string {
    const alphabet = AppConstants.CONTEST.INVITE_CODE_ALPHABET;
    const len = AppConstants.CONTEST.INVITE_CODE_LENGTH;
    let out = '';
    for (let i = 0; i < len; i++) {
      out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return out;
  }
}

export const contestService = new ContestService();
export { ContestService };

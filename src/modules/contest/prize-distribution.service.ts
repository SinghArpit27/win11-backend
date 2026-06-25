import type { Request } from 'express';

import { ErrorCode, HttpStatus } from '@common/constants';
import { AuditAction, PrizeDistributionType } from '@common/enums';
import { AppError, NotFoundError } from '@common/errors';
import { auditLogger } from '@common/logging';

import { BaseService } from '@shared/services/base.service';

import { contestCache } from './contest-cache';
import { contestRepository } from './contest.repository';
import { validateSlabs } from './contest.validators';
import {
  PrizeDistribution,
  type IPrizeSlab,
  type PrizeDistributionDoc,
} from './prize-distribution.model';
import { prizeDistributionRepository } from './prize-distribution.repository';
import type {
  PrizeDistributionCreateBody,
  PrizeDistributionListQuery,
  PrizeDistributionUpdateBody,
} from './contest.validators';

/**
 * Manages the `prize_distributions` collection — the reusable templates
 * admins point contests at.
 *
 * Writes are non-transactional (single document) but still emit audit
 * rows and flush the contest-level cache so stale snapshots can never
 * pollute the listings UI.
 */
class PrizeDistributionService extends BaseService {
  constructor() {
    super('prize-distribution-service');
  }

  list(query: PrizeDistributionListQuery) {
    const { type, isActive, q, page, limit, sortBy, sortOrder } = query;
    return prizeDistributionRepository.list(
      { type, isActive, q },
      { page, limit, sortBy, sortOrder: sortOrder ?? 'desc' },
    );
  }

  async getById(id: string): Promise<PrizeDistributionDoc> {
    const doc = await prizeDistributionRepository.findById(id);
    if (!doc) {
      throw new AppError(
        'Prize distribution not found',
        HttpStatus.NOT_FOUND,
        ErrorCode.PRIZE_DISTRIBUTION_NOT_FOUND,
      );
    }
    return doc;
  }

  async create(
    body: PrizeDistributionCreateBody,
    actor: { id: string | null; roles?: string[]; req?: Request },
  ): Promise<PrizeDistributionDoc> {
    this.assertValidSlabs(body.slabs, body.type, body.referencePoolAmount);

    const maxWinningRank = body.slabs.reduce((max, s) => Math.max(max, s.toRank), 0);
    const doc = await prizeDistributionRepository.create({
      name: body.name,
      description: body.description ?? null,
      type: body.type,
      referencePoolAmount: body.referencePoolAmount,
      currency: body.currency,
      slabs: body.slabs.map(this.normaliseSlab),
      maxWinningRank,
      isActive: body.isActive ?? true,
      tags: body.tags ?? [],
    });

    await auditLogger.success({
      action: AuditAction.CONTEST_PRIZE_UPDATED,
      actorId: actor.id,
      actorRoles: actor.roles,
      resource: 'prize_distribution',
      resourceId: String(doc._id),
      metadata: { type: doc.type, slabs: doc.slabs.length, pool: doc.referencePoolAmount },
      req: actor.req,
    });

    await contestCache.flushScope('prize');
    return doc;
  }

  async update(
    id: string,
    body: PrizeDistributionUpdateBody,
    actor: { id: string | null; roles?: string[]; req?: Request },
  ): Promise<PrizeDistributionDoc> {
    const existing = await this.getById(id);

    const merged = {
      type: body.type ?? existing.type,
      referencePoolAmount: body.referencePoolAmount ?? existing.referencePoolAmount,
      slabs: body.slabs ?? existing.slabs,
    };
    this.assertValidSlabs(merged.slabs, merged.type, merged.referencePoolAmount);

    const maxWinningRank = merged.slabs.reduce(
      (max, s) => Math.max(max, s.toRank),
      0,
    );

    const updated = await prizeDistributionRepository.updateById(id, {
      $set: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.currency !== undefined && { currency: body.currency }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.tags !== undefined && { tags: body.tags }),
        type: merged.type,
        referencePoolAmount: merged.referencePoolAmount,
        slabs: merged.slabs.map(this.normaliseSlab),
        maxWinningRank,
      },
    });
    if (!updated) {
      throw new NotFoundError('Prize distribution');
    }

    await auditLogger.success({
      action: AuditAction.CONTEST_PRIZE_UPDATED,
      actorId: actor.id,
      actorRoles: actor.roles,
      resource: 'prize_distribution',
      resourceId: id,
      metadata: { type: updated.type, slabs: updated.slabs.length },
      req: actor.req,
    });

    await contestCache.flushScope('prize');
    return updated;
  }

  async delete(
    id: string,
    actor: { id: string | null; roles?: string[]; req?: Request },
  ): Promise<void> {
    const inUse = await contestRepository.prizeDistributionInUse(id);
    if (inUse) {
      throw new AppError(
        'Prize distribution is referenced by live contests',
        HttpStatus.CONFLICT,
        ErrorCode.CONTEST_HAS_ENTRIES,
      );
    }
    const doc = await PrizeDistribution.findByIdAndUpdate(
      id,
      { $set: { isDeleted: true, deletedAt: new Date(), isActive: false } },
      { new: true },
    ).exec();
    if (!doc) throw new NotFoundError('Prize distribution');

    await auditLogger.success({
      action: AuditAction.CONTEST_PRIZE_UPDATED,
      actorId: actor.id,
      actorRoles: actor.roles,
      resource: 'prize_distribution',
      resourceId: id,
      metadata: { deleted: true },
      req: actor.req,
    });

    await contestCache.flushScope('prize');
  }

  /** Internal helper exposed so the contest service can bind a saved
   *  template to a contest at create time. Throws when invalid. */
  assertValidSlabs(
    slabs: Array<Pick<IPrizeSlab, 'fromRank' | 'toRank' | 'prizeAmount' | 'percentageBps'>>,
    type: PrizeDistributionType,
    pool: number | null,
  ): void {
    const res = validateSlabs(slabs, type, pool);
    if (!res.ok) {
      throw new AppError(
        `Invalid prize slabs: ${res.reason}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.PRIZE_DISTRIBUTION_INVALID,
      );
    }
  }

  private normaliseSlab(slab: PrizeDistributionCreateBody['slabs'][number]): IPrizeSlab {
    return {
      fromRank: slab.fromRank,
      toRank: slab.toRank,
      prizeAmount: slab.prizeAmount ?? 0,
      percentageBps: slab.percentageBps ?? 0,
      bonusLabel: slab.bonusLabel ?? null,
    };
  }
}

export const prizeDistributionService = new PrizeDistributionService();
export { PrizeDistributionService };

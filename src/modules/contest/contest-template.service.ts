import type { Request } from 'express';
import { Types } from 'mongoose';

import { ErrorCode, HttpStatus } from '@common/constants';
import { AuditAction } from '@common/enums';
import { AppError, NotFoundError } from '@common/errors';
import { auditLogger } from '@common/logging';

import { BaseService } from '@shared/services/base.service';

import { contestCache } from './contest-cache';
import {
  ContestTemplate,
  type ContestTemplateDoc,
} from './contest-template.model';
import { contestTemplateRepository } from './contest-template.repository';
import { contestRepository } from './contest.repository';
import type {
  ContestTemplateCreateBody,
  ContestTemplateListQuery,
  ContestTemplateUpdateBody,
} from './contest.validators';

/**
 * `contest_templates` lifecycle.
 *
 * Templates are *blueprints* — contests are spun up from them but carry
 * their own copy of every field, so editing a template never silently
 * mutates live contests.
 */
class ContestTemplateService extends BaseService {
  constructor() {
    super('contest-template-service');
  }

  list(query: ContestTemplateListQuery) {
    const { type, visibility, sport, isActive, q, page, limit, sortBy, sortOrder } = query;
    return contestTemplateRepository.list(
      { type, visibility, sport, isActive, q },
      { page, limit, sortBy, sortOrder: sortOrder ?? 'desc' },
    );
  }

  /** Lightweight read used by the admin "Create contest from template" picker. */
  findActive(): Promise<ContestTemplateDoc[]> {
    return contestTemplateRepository.findActive();
  }

  async getById(id: string): Promise<ContestTemplateDoc> {
    const doc = await contestTemplateRepository.findById(id);
    if (!doc) {
      throw new AppError(
        'Contest template not found',
        HttpStatus.NOT_FOUND,
        ErrorCode.CONTEST_TEMPLATE_NOT_FOUND,
      );
    }
    return doc;
  }

  async create(
    body: ContestTemplateCreateBody,
    actor: { id: string | null; roles?: string[]; req?: Request },
  ): Promise<ContestTemplateDoc> {
    const doc = await contestTemplateRepository.create({
      name: body.name,
      description: body.description ?? null,
      type: body.type,
      visibility: body.visibility,
      sport: body.sport ?? null,
      format: body.format ?? null,
      entryFee: body.entryFee,
      prizePoolAmount: body.prizePoolAmount,
      currency: body.currency,
      isGuaranteed: body.isGuaranteed,
      totalSpots: body.totalSpots,
      maxEntriesPerUser: body.maxEntriesPerUser,
      prizeDistributionId: body.prizeDistributionId
        ? new Types.ObjectId(body.prizeDistributionId)
        : null,
      tags: body.tags ?? [],
      isActive: body.isActive ?? true,
      createdBy: actor.id ? new Types.ObjectId(actor.id) : null,
      updatedBy: actor.id ? new Types.ObjectId(actor.id) : null,
    });

    await auditLogger.success({
      action: AuditAction.CONTEST_TEMPLATE_CREATED,
      actorId: actor.id,
      actorRoles: actor.roles,
      resource: 'contest_template',
      resourceId: String(doc._id),
      metadata: { type: doc.type, entryFee: doc.entryFee, spots: doc.totalSpots },
      req: actor.req,
    });

    await contestCache.flushScope('template');
    return doc;
  }

  async update(
    id: string,
    body: ContestTemplateUpdateBody,
    actor: { id: string | null; roles?: string[]; req?: Request },
  ): Promise<ContestTemplateDoc> {
    const existing = await this.getById(id);

    const updated = await contestTemplateRepository.updateById(id, {
      $set: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.type !== undefined && { type: body.type }),
        ...(body.visibility !== undefined && { visibility: body.visibility }),
        ...(body.sport !== undefined && { sport: body.sport }),
        ...(body.format !== undefined && { format: body.format }),
        ...(body.entryFee !== undefined && { entryFee: body.entryFee }),
        ...(body.prizePoolAmount !== undefined && { prizePoolAmount: body.prizePoolAmount }),
        ...(body.currency !== undefined && { currency: body.currency }),
        ...(body.isGuaranteed !== undefined && { isGuaranteed: body.isGuaranteed }),
        ...(body.totalSpots !== undefined && { totalSpots: body.totalSpots }),
        ...(body.maxEntriesPerUser !== undefined && { maxEntriesPerUser: body.maxEntriesPerUser }),
        ...(body.prizeDistributionId !== undefined && {
          prizeDistributionId: body.prizeDistributionId
            ? new Types.ObjectId(body.prizeDistributionId)
            : null,
        }),
        ...(body.tags !== undefined && { tags: body.tags }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        updatedBy: actor.id ? new Types.ObjectId(actor.id) : null,
      },
    });
    if (!updated) throw new NotFoundError('Contest template');

    await auditLogger.success({
      action: AuditAction.CONTEST_TEMPLATE_UPDATED,
      actorId: actor.id,
      actorRoles: actor.roles,
      resource: 'contest_template',
      resourceId: id,
      metadata: { previousType: existing.type, newType: updated.type },
      req: actor.req,
    });

    await contestCache.flushScope('template');
    return updated;
  }

  async delete(
    id: string,
    actor: { id: string | null; roles?: string[]; req?: Request },
  ): Promise<void> {
    const inUse = await contestRepository.templateInUse(id);
    if (inUse) {
      throw new AppError(
        'Template is referenced by contests',
        HttpStatus.CONFLICT,
        ErrorCode.CONTEST_TEMPLATE_IN_USE,
      );
    }

    const doc = await ContestTemplate.findByIdAndUpdate(
      id,
      { $set: { isDeleted: true, deletedAt: new Date(), isActive: false } },
      { new: true },
    ).exec();
    if (!doc) throw new NotFoundError('Contest template');

    await auditLogger.success({
      action: AuditAction.CONTEST_TEMPLATE_DELETED,
      actorId: actor.id,
      actorRoles: actor.roles,
      resource: 'contest_template',
      resourceId: id,
      metadata: { name: doc.name },
      req: actor.req,
    });

    await contestCache.flushScope('template');
  }
}

export const contestTemplateService = new ContestTemplateService();
export { ContestTemplateService };

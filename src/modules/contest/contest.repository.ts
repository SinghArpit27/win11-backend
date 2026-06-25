import type { ClientSession, FilterQuery, Types, UpdateQuery } from 'mongoose';

import { ContestStatus, ContestType, ContestVisibility, Sport } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import { Contest, type ContestDoc, type IContest } from './contest.model';

interface ContestListFilter {
  matchId?: Types.ObjectId | string;
  matchIds?: Array<Types.ObjectId | string>;
  sport?: Sport;
  type?: ContestType;
  visibility?: ContestVisibility;
  status?: ContestStatus | ContestStatus[];
  /** When true, return PRIVATE contests too (admin scope). */
  includePrivate?: boolean;
  /** Free-text search across name / description. */
  q?: string;
  /** Entry-fee window (minor units). */
  minEntryFee?: number;
  maxEntryFee?: number;
  /** When true, hide FULL contests (user listing default). */
  hideFull?: boolean;
}

class ContestRepository extends BaseRepository<IContest> {
  constructor() {
    super(Contest);
  }

  list(filters: ContestListFilter, pagination: PaginationParams): Promise<Paginated<ContestDoc>> {
    return this.paginate(this.buildFilter(filters), pagination, {
      defaultSortBy: 'prizePoolAmount',
    });
  }

  findByIdActive(id: Types.ObjectId | string): Promise<ContestDoc | null> {
    return this.findOne({ _id: id });
  }

  findByInviteCode(code: string): Promise<ContestDoc | null> {
    return this.findOne({ inviteCode: code.toUpperCase().trim() });
  }

  /**
   * Atomically increments `filledSpots` ONLY when there is room left.
   *
   * Returns the updated contest doc, or `null` when the join would have
   * exceeded `totalSpots` (the FE then renders a "Contest just filled
   * up" error). Critical for concurrency-safe joins — two parallel
   * requests can never both succeed when only one slot remains.
   *
   * MUST run inside the join transaction so the spot increment + the
   * entry insert + the wallet lock all commit (or roll back) together.
   */
  async incrementFilledSpot(
    contestId: Types.ObjectId | string,
    session: ClientSession,
  ): Promise<ContestDoc | null> {
    return Contest.findOneAndUpdate(
      {
        _id: contestId,
        status: { $in: [ContestStatus.OPEN, ContestStatus.SCHEDULED] },
        $expr: { $lt: ['$filledSpots', '$totalSpots'] },
      },
      {
        $inc: { filledSpots: 1, version: 1 },
        $set: { lastJoinedAt: new Date() },
      },
      { new: true, session },
    ).exec();
  }

  /**
   * Compensating decrement used by the rollback path when an entry
   * insert succeeds but a downstream wallet step blows up.
   * Floors at zero to protect against double-rollback bugs.
   */
  async decrementFilledSpot(
    contestId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<ContestDoc | null> {
    return Contest.findOneAndUpdate(
      { _id: contestId, filledSpots: { $gt: 0 } },
      { $inc: { filledSpots: -1, version: 1 } },
      { new: true, session },
    ).exec();
  }

  /** Bulk-flip every contest tied to a match into a new status. */
  async bulkSetStatus(
    matchId: Types.ObjectId | string,
    fromStatuses: ContestStatus[],
    toStatus: ContestStatus,
    session?: ClientSession,
  ): Promise<number> {
    const res = await Contest.updateMany(
      { matchId, status: { $in: fromStatuses } },
      { $set: { status: toStatus }, $inc: { version: 1 } },
      { session },
    ).exec();
    return res.modifiedCount ?? 0;
  }

  /**
   * Bumps a single contest into a target status with optional patch.
   * `expectedStatuses` makes this CAS-style — if the contest moved out
   * of the expected status under us, no change is applied.
   */
  async setStatus(
    contestId: Types.ObjectId | string,
    toStatus: ContestStatus,
    options: {
      expectedStatuses?: ContestStatus[];
      patch?: UpdateQuery<IContest>;
      session?: ClientSession;
    } = {},
  ): Promise<ContestDoc | null> {
    const filter: FilterQuery<IContest> = { _id: contestId };
    if (options.expectedStatuses?.length) {
      filter.status = { $in: options.expectedStatuses };
    }
    const update: UpdateQuery<IContest> = {
      ...(options.patch ?? {}),
      $set: { ...(options.patch?.$set as object | undefined), status: toStatus },
      $inc: { ...(options.patch?.$inc as object | undefined), version: 1 },
    };
    return Contest.findOneAndUpdate(filter, update, {
      new: true,
      session: options.session,
    }).exec();
  }

  /** True if the template is referenced by at least one non-deleted contest. */
  templateInUse(templateId: Types.ObjectId | string): Promise<boolean> {
    return this.exists({ templateId });
  }

  /** True if the prize distribution is referenced by an embedded snapshot. */
  prizeDistributionInUse(distributionId: Types.ObjectId | string): Promise<boolean> {
    return this.exists({ 'prizeSnapshot.distributionId': distributionId });
  }

  private buildFilter(filters: ContestListFilter): FilterQuery<IContest> {
    const filter: FilterQuery<IContest> = {};
    if (filters.matchId) filter.matchId = filters.matchId;
    if (filters.matchIds?.length) filter.matchId = { $in: filters.matchIds };
    if (filters.sport) filter.sport = filters.sport;
    if (filters.type) filter.type = filters.type;
    if (filters.visibility) filter.visibility = filters.visibility;
    if (filters.status) {
      filter.status = Array.isArray(filters.status)
        ? { $in: filters.status }
        : filters.status;
    }
    if (!filters.includePrivate) {
      filter.visibility = filter.visibility ?? ContestVisibility.PUBLIC;
    }
    if (filters.hideFull) {
      filter.$expr = { $lt: ['$filledSpots', '$totalSpots'] };
    }
    if (typeof filters.minEntryFee === 'number' || typeof filters.maxEntryFee === 'number') {
      filter.entryFee = {};
      if (typeof filters.minEntryFee === 'number') {
        (filter.entryFee as Record<string, number>).$gte = filters.minEntryFee;
      }
      if (typeof filters.maxEntryFee === 'number') {
        (filter.entryFee as Record<string, number>).$lte = filters.maxEntryFee;
      }
    }
    if (filters.q) {
      filter.$or = [
        { name: { $regex: filters.q, $options: 'i' } },
        { description: { $regex: filters.q, $options: 'i' } },
      ];
    }
    return filter;
  }
}

export const contestRepository = new ContestRepository();
export { ContestRepository };

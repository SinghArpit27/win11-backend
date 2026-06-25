import type { ClientSession, FilterQuery, Types } from 'mongoose';

import { ContestEntryStatus } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import {
  ContestEntry,
  type ContestEntryDoc,
  type IContestEntry,
} from './contest-entry.model';

interface EntryListFilter {
  userId?: Types.ObjectId | string;
  contestId?: Types.ObjectId | string;
  matchId?: Types.ObjectId | string;
  status?: ContestEntryStatus | ContestEntryStatus[];
}

class ContestEntryRepository extends BaseRepository<IContestEntry> {
  constructor() {
    super(ContestEntry);
  }

  list(filter: EntryListFilter, pagination: PaginationParams): Promise<Paginated<ContestEntryDoc>> {
    return this.paginate(this.buildFilter(filter), pagination, { defaultSortBy: 'joinedAt' });
  }

  findActiveByContestAndTeam(
    contestId: Types.ObjectId | string,
    teamId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<ContestEntryDoc | null> {
    return ContestEntry.findOne({
      contestId,
      teamId,
      status: ContestEntryStatus.ACTIVE,
    })
      .session(session ?? null)
      .exec();
  }

  findByIdempotencyKey(
    userId: Types.ObjectId | string,
    idempotencyKey: string,
    session?: ClientSession,
  ): Promise<ContestEntryDoc | null> {
    return ContestEntry.findOne({ userId, idempotencyKey })
      .session(session ?? null)
      .exec();
  }

  countActiveForUserInContest(
    contestId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<number> {
    return ContestEntry.countDocuments({
      contestId,
      userId,
      status: ContestEntryStatus.ACTIVE,
    })
      .session(session ?? null)
      .exec();
  }

  countActiveForContest(contestId: Types.ObjectId | string): Promise<number> {
    return this.count({ contestId, status: ContestEntryStatus.ACTIVE });
  }

  /** Distinct user count — used to refresh the denormalised counter. */
  async distinctParticipantCount(contestId: Types.ObjectId | string): Promise<number> {
    const ids = await ContestEntry.distinct('userId', {
      contestId,
      status: ContestEntryStatus.ACTIVE,
    }).exec();
    return ids.length;
  }

  /** All entries for one user inside a contest — drives entry-counter labels. */
  findForUserInContest(
    contestId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
  ): Promise<ContestEntryDoc[]> {
    return this.find(
      { contestId, userId, status: ContestEntryStatus.ACTIVE },
      { sort: { entryNumber: 1 } },
    );
  }

  /** All ACTIVE entries for a contest — used by the cancellation refund sweep. */
  findActiveForContest(
    contestId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<ContestEntryDoc[]> {
    return ContestEntry.find({ contestId, status: ContestEntryStatus.ACTIVE })
      .session(session ?? null)
      .exec();
  }

  markRefunded(
    entryId: Types.ObjectId | string,
    refundTransactionId: Types.ObjectId | string,
    reason: string,
    session?: ClientSession,
  ): Promise<ContestEntryDoc | null> {
    return ContestEntry.findByIdAndUpdate(
      entryId,
      {
        $set: {
          status: ContestEntryStatus.REFUNDED,
          refundTransactionId,
          refundReason: reason,
          refundedAt: new Date(),
        },
      },
      { new: true, session },
    ).exec();
  }

  markCancelled(
    entryId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<ContestEntryDoc | null> {
    return ContestEntry.findByIdAndUpdate(
      entryId,
      { $set: { status: ContestEntryStatus.CANCELLED } },
      { new: true, session },
    ).exec();
  }

  /**
   * Phase 7 — finalise an entry's rank + winnings + status. Called by
   * the settlement worker inside a transaction so the wallet credit
   * (separate txn doc) and the entry update share the same audit
   * trail.
   */
  markSettled(
    entryId: Types.ObjectId | string,
    payload: { rank: number; winningAmount: number },
    session?: ClientSession,
  ): Promise<ContestEntryDoc | null> {
    return ContestEntry.findByIdAndUpdate(
      entryId,
      {
        $set: {
          status: ContestEntryStatus.SETTLED,
          rank: payload.rank,
          winningAmount: payload.winningAmount,
          settledAt: new Date(),
        },
      },
      { new: true, session },
    ).exec();
  }

  private buildFilter(filters: EntryListFilter): FilterQuery<IContestEntry> {
    const filter: FilterQuery<IContestEntry> = {};
    if (filters.userId) filter.userId = filters.userId;
    if (filters.contestId) filter.contestId = filters.contestId;
    if (filters.matchId) filter.matchId = filters.matchId;
    if (filters.status) {
      filter.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
    }
    return filter;
  }
}

export const contestEntryRepository = new ContestEntryRepository();
export { ContestEntryRepository };

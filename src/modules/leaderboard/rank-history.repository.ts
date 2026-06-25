import type { ClientSession, Types } from 'mongoose';

import { LeaderboardScope } from '@common/enums';

import { BaseRepository } from '@shared/repositories/base.repository';

import { RankHistory, type IRankHistory, type RankHistoryDoc } from './rank-history.model';

interface CreateRankHistoryInput
  extends Omit<IRankHistory, '_id' | 'isDeleted' | 'deletedAt' | 'createdAt' | 'updatedAt'> {}

class RankHistoryRepository extends BaseRepository<IRankHistory> {
  constructor() {
    super(RankHistory);
  }

  /**
   * Append a batch of history rows — used by the snapshot worker. The
   * collection is append-only so `insertMany` (ordered=false) is the
   * fastest path; one bad row never aborts the batch.
   */
  async bulkAppend(rows: CreateRankHistoryInput[], session?: ClientSession): Promise<number> {
    if (rows.length === 0) return 0;
    const docs = await RankHistory.insertMany(rows as Partial<IRankHistory>[], {
      ordered: false,
      session,
    });
    return Array.isArray(docs) ? docs.length : 0;
  }

  findLatestForEntry(
    scope: LeaderboardScope,
    scopeId: Types.ObjectId | string,
    entryId: Types.ObjectId | string,
  ): Promise<RankHistoryDoc | null> {
    return RankHistory.findOne({ scope, scopeId, entryId })
      .sort({ capturedAt: -1 })
      .exec();
  }

  findRecentForEntry(
    scope: LeaderboardScope,
    scopeId: Types.ObjectId | string,
    entryId: Types.ObjectId | string,
    limit = 50,
  ): Promise<RankHistoryDoc[]> {
    return RankHistory.find({ scope, scopeId, entryId })
      .sort({ capturedAt: -1 })
      .limit(limit)
      .exec();
  }

  findUserHistoryForScope(
    userId: Types.ObjectId | string,
    scope: LeaderboardScope,
    scopeId: Types.ObjectId | string,
    limit = 50,
  ): Promise<RankHistoryDoc[]> {
    return RankHistory.find({ userId, scope, scopeId })
      .sort({ capturedAt: -1 })
      .limit(limit)
      .exec();
  }

  findUserRecentHistory(
    userId: Types.ObjectId | string,
    limit = 25,
  ): Promise<RankHistoryDoc[]> {
    return RankHistory.find({ userId }).sort({ capturedAt: -1 }).limit(limit).exec();
  }
}

export const rankHistoryRepository = new RankHistoryRepository();
export { RankHistoryRepository };

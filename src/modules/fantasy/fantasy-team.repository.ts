import type { ClientSession, FilterQuery, Types } from 'mongoose';

import { FantasyTeamStatus } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import { FantasyTeam, type FantasyTeamDoc, type IFantasyTeam } from './fantasy-team.model';

interface ListFilter {
  userId?: Types.ObjectId | string;
  matchId?: Types.ObjectId | string;
  status?: FantasyTeamStatus;
  includeDeleted?: boolean;
}

class FantasyTeamRepository extends BaseRepository<IFantasyTeam> {
  constructor() {
    super(FantasyTeam);
  }

  list(filters: ListFilter, pagination: PaginationParams): Promise<Paginated<FantasyTeamDoc>> {
    return this.paginate(this.buildFilter(filters), pagination, { defaultSortBy: 'updatedAt' });
  }

  countByUserAndMatch(
    userId: Types.ObjectId | string,
    matchId: Types.ObjectId | string,
  ): Promise<number> {
    return this.count({ userId, matchId });
  }

  findByUserAndMatch(
    userId: Types.ObjectId | string,
    matchId: Types.ObjectId | string,
  ): Promise<FantasyTeamDoc[]> {
    return this.find({ userId, matchId }, { sort: { createdAt: 1 } });
  }

  findByIdScoped(
    id: Types.ObjectId | string,
    userId: Types.ObjectId | string,
  ): Promise<FantasyTeamDoc | null> {
    return this.findOne({ _id: id, userId });
  }

  /**
   * Soft-deletes a fantasy team within a session. Phase 5 keeps deleted
   * teams for audit; Phase 7 will skip them in the leaderboard pipeline.
   */
  async softDelete(
    id: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<FantasyTeamDoc | null> {
    return FantasyTeam.findOneAndUpdate(
      { _id: id, userId },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true, session },
    ).exec();
  }

  /** Bulk-mark teams as locked when the match crosses lineup lock time. */
  lockTeamsForMatch(
    matchId: Types.ObjectId | string,
    lockedAt: Date,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    return FantasyTeam.updateMany(
      { matchId, status: FantasyTeamStatus.EDITABLE },
      { $set: { status: FantasyTeamStatus.LOCKED, lockedAt } },
      { session },
    )
      .exec()
      .then((r) => ({ modifiedCount: r.modifiedCount ?? 0 }));
  }

  private buildFilter(filters: ListFilter): FilterQuery<IFantasyTeam> {
    const filter: FilterQuery<IFantasyTeam> = {};
    if (filters.userId) filter.userId = filters.userId;
    if (filters.matchId) filter.matchId = filters.matchId;
    if (filters.status) filter.status = filters.status;
    return filter;
  }
}

export const fantasyTeamRepository = new FantasyTeamRepository();
export { FantasyTeamRepository };

import type { ClientSession, Types } from 'mongoose';

import { LeaderboardScope, type LeaderboardSnapshotReason } from '@common/enums';

import { BaseRepository } from '@shared/repositories/base.repository';

import {
  LeaderboardSnapshot,
  type ILeaderboardSnapshot,
  type ILeaderboardTopEntry,
  type LeaderboardSnapshotDoc,
} from './leaderboard-snapshot.model';

interface CreateSnapshotInput {
  scope: LeaderboardScope;
  scopeId: Types.ObjectId | string;
  matchId: Types.ObjectId | string;
  reason: LeaderboardSnapshotReason;
  totalEntries: number;
  topScore: number;
  topEntries: ILeaderboardTopEntry[];
  scoreEventId?: Types.ObjectId | string | null;
  capturedAt?: Date;
}

class LeaderboardSnapshotRepository extends BaseRepository<ILeaderboardSnapshot> {
  constructor() {
    super(LeaderboardSnapshot);
  }

  createSnapshot(
    input: CreateSnapshotInput,
    session?: ClientSession,
  ): Promise<LeaderboardSnapshotDoc> {
    return this.create(
      {
        scope: input.scope,
        scopeId: input.scopeId as Types.ObjectId,
        matchId: input.matchId as Types.ObjectId,
        reason: input.reason,
        totalEntries: input.totalEntries,
        topScore: input.topScore,
        topEntries: input.topEntries,
        scoreEventId: (input.scoreEventId ?? null) as Types.ObjectId | null,
        capturedAt: input.capturedAt ?? new Date(),
      } as Partial<ILeaderboardSnapshot>,
      session,
    );
  }

  findLatestForScope(
    scope: LeaderboardScope,
    scopeId: Types.ObjectId | string,
  ): Promise<LeaderboardSnapshotDoc | null> {
    return LeaderboardSnapshot.findOne({ scope, scopeId })
      .sort({ capturedAt: -1 })
      .exec();
  }

  findPreviousForScope(
    scope: LeaderboardScope,
    scopeId: Types.ObjectId | string,
    beforeCapturedAt: Date,
  ): Promise<LeaderboardSnapshotDoc | null> {
    return LeaderboardSnapshot.findOne({
      scope,
      scopeId,
      capturedAt: { $lt: beforeCapturedAt },
    })
      .sort({ capturedAt: -1 })
      .exec();
  }

  listForScope(
    scope: LeaderboardScope,
    scopeId: Types.ObjectId | string,
    limit = 20,
  ): Promise<LeaderboardSnapshotDoc[]> {
    return LeaderboardSnapshot.find({ scope, scopeId })
      .sort({ capturedAt: -1 })
      .limit(limit)
      .exec();
  }
}

export const leaderboardSnapshotRepository = new LeaderboardSnapshotRepository();
export { LeaderboardSnapshotRepository };

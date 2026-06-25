import type { AnyBulkWriteOperation, ClientSession, Types } from 'mongoose';

import { BaseRepository } from '@shared/repositories/base.repository';

import {
  FantasyPoints,
  type FantasyPointsDoc,
  type IFantasyPoints,
} from './fantasy-points.model';

interface UpsertFantasyPointsInput
  extends Omit<IFantasyPoints, '_id' | 'isDeleted' | 'deletedAt' | 'createdAt' | 'updatedAt'> {
  matchId: Types.ObjectId;
  playerId: Types.ObjectId;
}

class FantasyPointsRepository extends BaseRepository<IFantasyPoints> {
  constructor() {
    super(FantasyPoints);
  }

  findForMatch(matchId: Types.ObjectId | string): Promise<FantasyPointsDoc[]> {
    return FantasyPoints.find({ matchId }).sort({ basePoints: -1 }).exec();
  }

  findForPlayerInMatch(
    matchId: Types.ObjectId | string,
    playerId: Types.ObjectId | string,
  ): Promise<FantasyPointsDoc | null> {
    return FantasyPoints.findOne({ matchId, playerId }).exec();
  }

  findManyForPlayersInMatch(
    matchId: Types.ObjectId | string,
    playerIds: Array<Types.ObjectId | string>,
  ): Promise<FantasyPointsDoc[]> {
    if (playerIds.length === 0) return Promise.resolve([]);
    return FantasyPoints.find({ matchId, playerId: { $in: playerIds } }).exec();
  }

  /**
   * Atomic bulk upsert — one round-trip per matchId. The scoring engine
   * builds the operations vector entirely in memory and lets MongoDB
   * apply them ordered=false so a single bad row doesn't abort the
   * whole batch (we surface the failures through `score_events` instead).
   */
  bulkUpsert(
    docs: UpsertFantasyPointsInput[],
    session?: ClientSession,
  ): Promise<{ matched: number; upserted: number; modified: number }> {
    if (docs.length === 0) {
      return Promise.resolve({ matched: 0, upserted: 0, modified: 0 });
    }

    const operations: AnyBulkWriteOperation<IFantasyPoints>[] = docs.map((doc) => ({
      updateOne: {
        filter: { matchId: doc.matchId, playerId: doc.playerId },
        update: {
          $set: {
            teamId: doc.teamId,
            role: doc.role,
            basePoints: doc.basePoints,
            breakdown: doc.breakdown,
            events: doc.events,
            scoringRuleId: doc.scoringRuleId,
            scoringRuleVersion: doc.scoringRuleVersion,
            isPlayed: doc.isPlayed,
            isPlayerOfMatch: doc.isPlayerOfMatch,
            computedAt: doc.computedAt,
          },
          $setOnInsert: {
            matchId: doc.matchId,
            playerId: doc.playerId,
          },
        },
        upsert: true,
      },
    }));

    return FantasyPoints.bulkWrite(operations, { ordered: false, session }).then((res) => ({
      matched: res.matchedCount,
      upserted: res.upsertedCount,
      modified: res.modifiedCount,
    }));
  }

  deleteForMatch(
    matchId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<{ deletedCount: number }> {
    return FantasyPoints.deleteMany({ matchId })
      .session(session ?? null)
      .exec()
      .then((res) => ({ deletedCount: res.deletedCount ?? 0 }));
  }
}

export const fantasyPointsRepository = new FantasyPointsRepository();
export { FantasyPointsRepository };

import type { ClientSession, FilterQuery, Types } from 'mongoose';

import { BaseRepository } from '@shared/repositories/base.repository';

import {
  FantasyTeamDraft,
  type FantasyTeamDraftDoc,
  type IFantasyTeamDraft,
} from './fantasy-team-draft.model';

class FantasyTeamDraftRepository extends BaseRepository<IFantasyTeamDraft> {
  constructor() {
    super(FantasyTeamDraft);
  }

  /**
   * Finds a single draft slot for (user, match, clientDraftId). Pass
   * `null` for the default slot.
   */
  findSlot(
    userId: Types.ObjectId | string,
    matchId: Types.ObjectId | string,
    clientDraftId: string | null,
  ): Promise<FantasyTeamDraftDoc | null> {
    return this.findOne({ userId, matchId, clientDraftId });
  }

  listForUserAndMatch(
    userId: Types.ObjectId | string,
    matchId: Types.ObjectId | string,
  ): Promise<FantasyTeamDraftDoc[]> {
    return this.find({ userId, matchId }, { sort: { lastEditedAt: -1 } });
  }

  /**
   * Upsert a draft slot. The validator is run *outside* of this method —
   * the repository persists whatever the service hands it.
   */
  upsertSlot(
    userId: Types.ObjectId | string,
    matchId: Types.ObjectId | string,
    clientDraftId: string | null,
    payload: Partial<IFantasyTeamDraft>,
    session?: ClientSession,
  ): Promise<FantasyTeamDraftDoc | null> {
    const filter: FilterQuery<IFantasyTeamDraft> = { userId, matchId, clientDraftId };
    return FantasyTeamDraft.findOneAndUpdate(
      filter,
      { $set: { ...payload, lastEditedAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true, session },
    ).exec();
  }

  async hardDeleteBySlot(
    userId: Types.ObjectId | string,
    matchId: Types.ObjectId | string,
    clientDraftId: string | null,
    session?: ClientSession,
  ): Promise<number> {
    const result = await FantasyTeamDraft.deleteOne(
      { userId, matchId, clientDraftId },
      { session },
    ).exec();
    return result.deletedCount ?? 0;
  }

  async hardDeleteById(
    id: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<number> {
    const result = await FantasyTeamDraft.deleteOne({ _id: id, userId }, { session }).exec();
    return result.deletedCount ?? 0;
  }
}

export const fantasyTeamDraftRepository = new FantasyTeamDraftRepository();
export { FantasyTeamDraftRepository };

import type { ClientSession, Types } from 'mongoose';

import { BaseRepository } from '@shared/repositories/base.repository';

import {
  FantasyTeamPlayer,
  type FantasyTeamPlayerDoc,
  type IFantasyTeamPlayerRow,
} from './fantasy-team-player.model';

class FantasyTeamPlayerRepository extends BaseRepository<IFantasyTeamPlayerRow> {
  constructor() {
    super(FantasyTeamPlayer);
  }

  /**
   * Bulk-insert the flat projection rows that mirror a team's roster.
   * Called within the same transaction as the canonical team write so
   * the two collections never diverge.
   */
  async insertRoster(
    rows: Array<Partial<IFantasyTeamPlayerRow>>,
    session?: ClientSession,
  ): Promise<FantasyTeamPlayerDoc[]> {
    if (rows.length === 0) return [];
    return FantasyTeamPlayer.create(rows, { session, ordered: true });
  }

  /**
   * Replaces an existing team's projection rows. Soft-deletes the prior
   * rows and inserts the new ones — keeps the audit trail intact while
   * keeping the indexed-query result set tight.
   */
  async replaceRoster(
    fantasyTeamId: Types.ObjectId | string,
    rows: Array<Partial<IFantasyTeamPlayerRow>>,
    session?: ClientSession,
  ): Promise<FantasyTeamPlayerDoc[]> {
    await FantasyTeamPlayer.updateMany(
      { fantasyTeamId, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { session },
    ).exec();
    return this.insertRoster(rows, session);
  }

  /** Marks projection rows as deleted alongside the canonical team. */
  async softDeleteByTeamId(
    fantasyTeamId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<number> {
    const result = await FantasyTeamPlayer.updateMany(
      { fantasyTeamId, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { session },
    ).exec();
    return result.modifiedCount ?? 0;
  }

  /**
   * Returns the count of teams that picked a given player for a given
   * match. Powers the "Picked by N% of teams" UI label.
   */
  countSelectionsForPlayer(
    matchId: Types.ObjectId | string,
    playerId: Types.ObjectId | string,
  ): Promise<number> {
    return this.count({ matchId, playerId });
  }
}

export const fantasyTeamPlayerRepository = new FantasyTeamPlayerRepository();
export { FantasyTeamPlayerRepository };

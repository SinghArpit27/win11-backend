import type { ClientSession, FilterQuery, HydratedDocument, Types } from 'mongoose';

import { BaseRepository } from '@shared/repositories/base.repository';

import { MatchUpdate, type IMatchUpdate } from './match-update.model';

class MatchUpdateRepository extends BaseRepository<IMatchUpdate> {
  constructor() {
    super(MatchUpdate);
  }

  /**
   * Returns the highest `sequence` already persisted for the match.
   * Live-score ingestion uses this to compute the next sequence number
   * inside the same transaction.
   */
  async getLatestSequence(
    matchId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<number> {
    const doc = await this.model
      .findOne({ matchId })
      .sort({ sequence: -1 })
      .select({ sequence: 1 })
      .session(session ?? null)
      .lean();
    return doc?.sequence ?? 0;
  }

  /** Forward-only event stream from a given sequence. */
  listSince(
    matchId: string | Types.ObjectId,
    sinceSequence = 0,
    limit = 100,
  ): Promise<Array<HydratedDocument<IMatchUpdate>>> {
    const filter: FilterQuery<IMatchUpdate> = { matchId };
    if (sinceSequence > 0) filter.sequence = { $gt: sinceSequence };
    return this.find(filter, { sort: { sequence: 1 }, limit });
  }
}

export const matchUpdateRepository = new MatchUpdateRepository();
export { MatchUpdateRepository };

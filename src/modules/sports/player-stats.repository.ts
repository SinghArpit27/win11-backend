import type { ClientSession, HydratedDocument, Types } from 'mongoose';

import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import { PlayerStats, type IPlayerStats } from './player-stats.model';

class PlayerStatsRepository extends BaseRepository<IPlayerStats> {
  constructor() {
    super(PlayerStats);
  }

  /** Per-match lineup (both teams). */
  listForMatch(matchId: string | Types.ObjectId): Promise<Array<HydratedDocument<IPlayerStats>>> {
    return this.find({ matchId }, { sort: { isInLineup: -1, fantasyPoints: -1 } });
  }

  listForPlayer(
    playerId: string | Types.ObjectId,
    pagination: PaginationParams,
  ): Promise<Paginated<HydratedDocument<IPlayerStats>>> {
    return this.paginate({ playerId }, pagination, { defaultSortBy: 'createdAt' });
  }

  /**
   * Upsert a single per-match statline. The (matchId, playerId) unique
   * index guarantees idempotency for re-runs of the live-score worker.
   */
  upsertForMatchPlayer(
    matchId: Types.ObjectId,
    playerId: Types.ObjectId,
    update: Partial<IPlayerStats>,
    session?: ClientSession,
  ): Promise<HydratedDocument<IPlayerStats> | null> {
    return this.model
      .findOneAndUpdate(
        { matchId, playerId },
        { $set: update, $setOnInsert: { matchId, playerId } },
        { new: true, upsert: true, setDefaultsOnInsert: true, session: session ?? null },
      )
      .exec();
  }
}

export const playerStatsRepository = new PlayerStatsRepository();
export { PlayerStatsRepository };

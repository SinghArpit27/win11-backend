import type { FilterQuery, Types } from 'mongoose';

import { type PlayerRole, type Sport } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import { Player, type IPlayer, type PlayerDoc } from './player.model';

interface ListFilter {
  sport?: Sport;
  role?: PlayerRole;
  teamId?: string | Types.ObjectId;
  q?: string;
}

class PlayerRepository extends BaseRepository<IPlayer> {
  constructor() {
    super(Player);
  }

  list(filters: ListFilter, pagination: PaginationParams): Promise<Paginated<PlayerDoc>> {
    const filter = this.buildFilter(filters);
    return this.paginate(filter, pagination, { defaultSortBy: 'name' });
  }

  findByExternalId(providerKey: string, externalId: string): Promise<PlayerDoc | null> {
    return this.findOne({
      externalIds: { $elemMatch: { providerKey, id: externalId } },
    });
  }

  /** Per-team roster — used by the lineup endpoints. */
  listByTeam(teamId: string | Types.ObjectId, limit = 200): Promise<PlayerDoc[]> {
    return this.find({ teamId, isActive: true }, { limit, sort: { name: 1 } });
  }

  private buildFilter(filters: ListFilter): FilterQuery<IPlayer> {
    const filter: FilterQuery<IPlayer> = { isActive: true };
    if (filters.sport) filter.sport = filters.sport;
    if (filters.role) filter.role = filters.role;
    if (filters.teamId) filter.teamId = filters.teamId as Types.ObjectId;
    if (filters.q) {
      filter.$or = [
        { name: { $regex: filters.q, $options: 'i' } },
        { shortName: { $regex: filters.q, $options: 'i' } },
      ];
    }
    return filter;
  }
}

export const playerRepository = new PlayerRepository();
export { PlayerRepository };

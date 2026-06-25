import type { FilterQuery, Types } from 'mongoose';

import type { Sport } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import { Team, type ITeam, type TeamDoc } from './team.model';

interface ListFilter {
  sport?: Sport;
  q?: string;
}

class TeamRepository extends BaseRepository<ITeam> {
  constructor() {
    super(Team);
  }

  list(filters: ListFilter, pagination: PaginationParams): Promise<Paginated<TeamDoc>> {
    const filter = this.buildFilter(filters);
    return this.paginate(filter, pagination, { defaultSortBy: 'name' });
  }

  findByExternalId(providerKey: string, externalId: string): Promise<TeamDoc | null> {
    return this.findOne({
      externalIds: { $elemMatch: { providerKey, id: externalId } },
    });
  }

  /** Bulk look-up by ids — preserves order via a Map under the hood. */
  async findByIds(ids: Array<string | Types.ObjectId>): Promise<Map<string, TeamDoc>> {
    if (ids.length === 0) return new Map();
    const docs = await this.find({ _id: { $in: ids } } as FilterQuery<ITeam>);
    return new Map(docs.map((d) => [String(d._id), d]));
  }

  private buildFilter(filters: ListFilter): FilterQuery<ITeam> {
    const filter: FilterQuery<ITeam> = {};
    if (filters.sport) filter.sport = filters.sport;
    if (filters.q) {
      filter.$or = [
        { name: { $regex: filters.q, $options: 'i' } },
        { shortName: { $regex: filters.q, $options: 'i' } },
      ];
    }
    return filter;
  }
}

export const teamRepository = new TeamRepository();
export { TeamRepository };

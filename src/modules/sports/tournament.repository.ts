import type { FilterQuery } from 'mongoose';

import { Sport, TournamentStatus } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import { Tournament, type ITournament, type TournamentDoc } from './tournament.model';

interface ListFilter {
  sport?: Sport;
  status?: TournamentStatus;
  q?: string;
}

class TournamentRepository extends BaseRepository<ITournament> {
  constructor() {
    super(Tournament);
  }

  list(filters: ListFilter, pagination: PaginationParams): Promise<Paginated<TournamentDoc>> {
    const filter = this.buildFilter(filters);
    return this.paginate(filter, pagination, { defaultSortBy: 'startDate' });
  }

  /**
   * Looks up a tournament by a `(providerKey, externalId)` pair.
   * Used by `TournamentIngestionService.upsertFromProvider` to keep
   * tournament rows stable across provider runs.
   */
  findByExternalId(providerKey: string, externalId: string): Promise<TournamentDoc | null> {
    return this.findOne({
      externalIds: { $elemMatch: { providerKey, id: externalId } },
    });
  }

  /** Sport-scoped tournament catalogue for filter chips. */
  listForSport(sport: Sport, limit = 50): Promise<TournamentDoc[]> {
    return this.find({ sport }, { limit, sort: { startDate: -1 } });
  }

  private buildFilter(filters: ListFilter): FilterQuery<ITournament> {
    const filter: FilterQuery<ITournament> = {};
    if (filters.sport) filter.sport = filters.sport;
    if (filters.status) filter.status = filters.status;
    if (filters.q) {
      filter.$or = [
        { name: { $regex: filters.q, $options: 'i' } },
        { shortName: { $regex: filters.q, $options: 'i' } },
      ];
    }
    return filter;
  }
}

export const tournamentRepository = new TournamentRepository();
export { TournamentRepository };

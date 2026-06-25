import { type Sport, type TournamentStatus } from '@common/enums';
import { NotFoundError } from '@common/errors';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { tournamentRepository } from './tournament.repository';
import { tournamentSerializer } from './sports.serializers';
import { sportsCacheService } from './sports-cache.service';
import type { SportsTournamentDTO } from './sports.types';

class TournamentService {
  async list(
    filters: { sport?: Sport; status?: TournamentStatus; q?: string },
    pagination: PaginationParams,
  ): Promise<Paginated<SportsTournamentDTO>> {
    const { items, meta } = await tournamentRepository.list(filters, pagination);
    return {
      items: items.map(tournamentSerializer.toDTO),
      meta,
    };
  }

  /**
   * Sport-scoped catalogue used by the home-screen filter chips. Cached
   * per-sport because the list rarely changes.
   */
  async listForSport(sport: Sport): Promise<SportsTournamentDTO[]> {
    return sportsCacheService.tournamentList(sport, async () => {
      const docs = await tournamentRepository.listForSport(sport);
      return docs.map(tournamentSerializer.toDTO);
    });
  }

  async getById(tournamentId: string): Promise<SportsTournamentDTO> {
    const doc = await tournamentRepository.findById(tournamentId);
    if (!doc) throw new NotFoundError('Tournament');
    return tournamentSerializer.toDTO(doc);
  }
}

export const tournamentService = new TournamentService();
export { TournamentService };

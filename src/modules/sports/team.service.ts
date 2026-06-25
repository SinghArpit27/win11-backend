import { type Sport } from '@common/enums';
import { NotFoundError } from '@common/errors';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { playerRepository } from './player.repository';
import { teamRepository } from './team.repository';
import { playerSerializer, teamSerializer } from './sports.serializers';
import { sportsCacheService } from './sports-cache.service';
import type { SportsPlayerDTO, SportsTeamDTO } from './sports.types';

/**
 * Public team read service. Provides the team profile + the team's
 * current roster (active players only).
 */
class TeamService {
  async list(
    filters: { sport?: Sport; q?: string },
    pagination: PaginationParams,
  ): Promise<Paginated<SportsTeamDTO>> {
    const { items, meta } = await teamRepository.list(filters, pagination);
    return {
      items: items.map(teamSerializer.toDTO),
      meta,
    };
  }

  async getProfile(teamId: string): Promise<SportsTeamDTO> {
    return sportsCacheService.teamProfile(teamId, async () => {
      const doc = await teamRepository.findById(teamId);
      if (!doc) throw new NotFoundError('Team');
      return teamSerializer.toDTO(doc);
    });
  }

  async listRoster(teamId: string): Promise<SportsPlayerDTO[]> {
    const team = await teamRepository.findById(teamId);
    if (!team) throw new NotFoundError('Team');
    const players = await playerRepository.listByTeam(teamId);
    return players.map(playerSerializer.toDTO);
  }
}

export const teamService = new TeamService();
export { TeamService };

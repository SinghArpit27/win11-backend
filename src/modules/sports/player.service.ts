import { Types } from 'mongoose';

import { type PlayerRole, type Sport } from '@common/enums';
import { NotFoundError } from '@common/errors';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { playerStatsRepository } from './player-stats.repository';
import { playerRepository } from './player.repository';
import { playerSerializer, playerStatsSerializer } from './sports.serializers';
import { sportsCacheService } from './sports-cache.service';
import type { SportsPlayerDTO, SportsPlayerStatsDTO } from './sports.types';

/**
 * Public player read service. Cached per-player by `playerId`.
 */
class PlayerService {
  async list(
    filters: {
      sport?: Sport;
      role?: PlayerRole;
      teamId?: string;
      q?: string;
    },
    pagination: PaginationParams,
  ): Promise<Paginated<SportsPlayerDTO>> {
    const { items, meta } = await playerRepository.list(filters, pagination);
    return {
      items: items.map(playerSerializer.toDTO),
      meta,
    };
  }

  async getProfile(playerId: string): Promise<SportsPlayerDTO> {
    return sportsCacheService.playerProfile(playerId, async () => {
      const doc = await playerRepository.findById(playerId);
      if (!doc) throw new NotFoundError('Player');
      return playerSerializer.toDTO(doc);
    });
  }

  async listRecentStats(
    playerId: string,
    pagination: PaginationParams,
  ): Promise<Paginated<SportsPlayerStatsDTO>> {
    const exists = await playerRepository.exists({ _id: new Types.ObjectId(playerId) });
    if (!exists) throw new NotFoundError('Player');

    const { items, meta } = await playerStatsRepository.listForPlayer(playerId, pagination);
    return {
      items: items.map(playerStatsSerializer.toDTO),
      meta,
    };
  }
}

export const playerService = new PlayerService();
export { PlayerService };

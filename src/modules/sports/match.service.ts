import { type HydratedDocument, Types } from 'mongoose';

import { ErrorCode } from '@common/constants';
import { type MatchStatus, type Sport } from '@common/enums';
import { NotFoundError } from '@common/errors';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { matchUpdateRepository } from './match-update.repository';
import { type IMatch } from './match.model';
import { matchRepository } from './match.repository';
import { playerStatsRepository } from './player-stats.repository';
import { matchSerializer, matchUpdateSerializer, playerStatsSerializer } from './sports.serializers';
import { sportsCacheService } from './sports-cache.service';
import type {
  SportsMatchCardDTO,
  SportsMatchDetailDTO,
  SportsMatchUpdateDTO,
  SportsPlayerStatsDTO,
} from './sports.types';
import { teamRepository } from './team.repository';
import { tournamentRepository } from './tournament.repository';

/**
 * Public match read service.
 *
 * Hot path lookups go through the Redis cache (`sportsCacheService`).
 * The DB is hit only on cache miss, and reads are batched + projection-
 * limited so list endpoints stay snappy even with 10k+ matches.
 *
 * Card hydration is done in ONE pass:
 *   1. fetch matches (raw)
 *   2. collect distinct team ids + tournament ids
 *   3. bulk-load via `$in` queries
 *   4. project each card with the resolved refs
 *
 * That keeps response time O(1) Mongo round-trips per filter regardless
 * of page size — no N+1.
 */
class MatchService {
  /** Paginated list. NOT cached — too many filter permutations. */
  async listMatches(
    filters: {
      sport?: Sport;
      status?: MatchStatus;
      tournamentId?: string;
      teamId?: string;
      featured?: boolean;
      from?: Date;
      to?: Date;
      q?: string;
    },
    pagination: PaginationParams,
  ): Promise<Paginated<SportsMatchCardDTO>> {
    const result = await matchRepository.list(filters, pagination);
    const cards = await this.hydrateCards(result.items);
    return { items: cards, meta: result.meta };
  }

  /** Live matches feed. Cached for `LIVE_MATCH` TTL (10s). */
  async listLive(sport?: Sport, limit = 20): Promise<SportsMatchCardDTO[]> {
    return sportsCacheService.liveMatches(sport ?? 'ALL', async () => {
      const docs = await matchRepository.listLive(sport, limit);
      return this.hydrateCards(docs);
    });
  }

  /** Upcoming matches feed (rolling N-day window). */
  async listUpcoming(sport?: Sport, limit = 20): Promise<SportsMatchCardDTO[]> {
    return sportsCacheService.upcomingMatches(sport ?? 'ALL', limit, async () => {
      const docs = await matchRepository.listUpcoming(sport, undefined, limit);
      return this.hydrateCards(docs);
    });
  }

  /** Featured rail (admin-curated). */
  async listFeatured(sport?: Sport): Promise<SportsMatchCardDTO[]> {
    return sportsCacheService.featuredMatches(sport ?? 'ALL', async () => {
      const docs = await matchRepository.listFeatured(sport);
      return this.hydrateCards(docs);
    });
  }

  /** Trending rail (popularity-sorted). */
  async listTrending(sport?: Sport): Promise<SportsMatchCardDTO[]> {
    return sportsCacheService.trendingMatches(sport ?? 'ALL', async () => {
      const docs = await matchRepository.listTrending(sport);
      return this.hydrateCards(docs);
    });
  }

  /**
   * Match detail. Increments view count as a side-effect — fire and
   * forget so it doesn't add latency to the read path. View bumps are
   * NOT cached.
   */
  async getMatch(matchId: string): Promise<SportsMatchDetailDTO> {
    const detail = await sportsCacheService.matchDetail(matchId, async () => {
      const match = await matchRepository.findById(matchId);
      if (!match) {
        throw new NotFoundError('Match');
      }
      return this.hydrateDetail(match);
    });
    // Best-effort popularity bump (don't await — non-blocking).
    matchRepository
      .incrementViewCount(matchId)
      .catch(() => undefined);
    return detail;
  }

  /** Match-update replay since `sinceSequence` for live commentary. */
  async listUpdates(
    matchId: string,
    sinceSequence: number,
    limit: number,
  ): Promise<SportsMatchUpdateDTO[]> {
    const exists = await matchRepository.exists({ _id: new Types.ObjectId(matchId) });
    if (!exists) throw new NotFoundError('Match');
    const updates = await matchUpdateRepository.listSince(matchId, sinceSequence, limit);
    return updates.map(matchUpdateSerializer.toDTO);
  }

  /** Per-match player stats / lineup (for the future contest engine + UI). */
  async listPlayerStatsForMatch(matchId: string): Promise<SportsPlayerStatsDTO[]> {
    const exists = await matchRepository.exists({ _id: new Types.ObjectId(matchId) });
    if (!exists) throw new NotFoundError('Match');
    const stats = await playerStatsRepository.listForMatch(matchId);
    return stats.map(playerStatsSerializer.toDTO);
  }

  // ─── Bulk hydration helpers ──────────────────────────────────────────────

  private async hydrateCards(docs: HydratedDocument<IMatch>[]): Promise<SportsMatchCardDTO[]> {
    if (!docs.length) return [];

    const teamIds = new Set<string>();
    const tournamentIds = new Set<string>();
    for (const doc of docs) {
      teamIds.add(String(doc.homeTeamId));
      teamIds.add(String(doc.awayTeamId));
      tournamentIds.add(String(doc.tournamentId));
    }

    const [teamMap, tournamentMap] = await Promise.all([
      teamRepository.findByIds([...teamIds]),
      this.loadTournamentMap([...tournamentIds]),
    ]);

    return docs.flatMap((doc) => {
      const home = teamMap.get(String(doc.homeTeamId));
      const away = teamMap.get(String(doc.awayTeamId));
      const tournament = tournamentMap.get(String(doc.tournamentId));
      if (!home || !away || !tournament) return [];
      return [matchSerializer.toCardDTO(doc, { home, away, tournament })];
    });
  }

  private async hydrateDetail(doc: HydratedDocument<IMatch>): Promise<SportsMatchDetailDTO> {
    const [teamMap, tournament] = await Promise.all([
      teamRepository.findByIds([doc.homeTeamId, doc.awayTeamId]),
      tournamentRepository.findById(doc.tournamentId),
    ]);
    const home = teamMap.get(String(doc.homeTeamId));
    const away = teamMap.get(String(doc.awayTeamId));
    if (!home || !away || !tournament) {
      // Schema corruption — caller should never see this in production.
      throw new NotFoundError('Match references');
    }
    return matchSerializer.toDetailDTO(doc, { home, away, tournament });
  }

  private async loadTournamentMap(ids: string[]): Promise<
    Map<string, HydratedDocument<import('./tournament.model').ITournament>>
  > {
    if (!ids.length) return new Map();
    const docs = await tournamentRepository.find({ _id: { $in: ids } });
    return new Map(docs.map((d) => [String(d._id), d]));
  }
}

void ErrorCode.MATCH_NOT_FOUND;

export const matchService = new MatchService();
export { MatchService };

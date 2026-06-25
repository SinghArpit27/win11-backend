import { AppConstants } from '@common/constants';

/**
 * Centralised Redis key + TTL catalogue for the sports module.
 *
 * Keys are namespaced under `sports:` so we can flush the entire feature
 * with a single `SCAN ... MATCH 'sports:*'` sweep. TTLs live in
 * `AppConstants.SPORTS.CACHE_TTL` so the tuning surface stays in one
 * place.
 *
 *  Naming convention:
 *    sports:<entity>:<scope>:<filters>
 *
 *  Examples:
 *    sports:matches:live:CRICKET
 *    sports:matches:upcoming:ALL:limit=20
 *    sports:match:5f3b1c...:detail
 *    sports:players:CRICKET:role=BATSMAN
 */

const PREFIX = 'sports';

const join = (...parts: Array<string | number | undefined | null>): string =>
  parts.filter((p) => p !== undefined && p !== null && p !== '').join(':');

export const SportsCacheKeys = {
  /** Single match detail. */
  matchDetail: (matchId: string): string => join(PREFIX, 'match', matchId, 'detail'),

  /** List of currently-live matches (optionally scoped to a sport). */
  liveMatches: (sport: string | 'ALL' = 'ALL'): string =>
    join(PREFIX, 'matches', 'live', sport),

  /** Upcoming matches feed. Includes `limit` so different pages get different keys. */
  upcomingMatches: (sport: string | 'ALL' = 'ALL', limit = 20): string =>
    join(PREFIX, 'matches', 'upcoming', sport, `l${limit}`),

  featuredMatches: (sport: string | 'ALL' = 'ALL'): string =>
    join(PREFIX, 'matches', 'featured', sport),

  trendingMatches: (sport: string | 'ALL' = 'ALL'): string =>
    join(PREFIX, 'matches', 'trending', sport),

  playerProfile: (playerId: string): string => join(PREFIX, 'player', playerId, 'profile'),

  playerStats: (playerId: string): string => join(PREFIX, 'player', playerId, 'stats'),

  teamProfile: (teamId: string): string => join(PREFIX, 'team', teamId, 'profile'),

  tournamentList: (sport: string | 'ALL' = 'ALL'): string =>
    join(PREFIX, 'tournaments', sport),

  /** Used by `flush(scope)` to bulk-delete keys via SCAN. */
  scopePattern: (scope: 'all' | 'matches' | 'players' | 'teams' | 'tournaments'): string => {
    switch (scope) {
      case 'matches':
        return `${PREFIX}:match*`;
      case 'players':
        return `${PREFIX}:player*`;
      case 'teams':
        return `${PREFIX}:team*`;
      case 'tournaments':
        return `${PREFIX}:tournaments*`;
      case 'all':
      default:
        return `${PREFIX}:*`;
    }
  },
} as const;

export const SportsCacheTtl = AppConstants.SPORTS.CACHE_TTL;

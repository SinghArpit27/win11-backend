import { isRedisEnabled, redis } from '@config/redis.config';
import { logger } from '@config/logger.config';

import { AppConstants } from '@common/constants';
import { cache } from '@common/utils/cache.util';

/**
 * Tiny cache helper scoped to the fantasy module.
 *
 * We keep things lightweight here — the fantasy module has only a handful
 * of cached entities (active rule + active scoring rule per sport-format)
 * so a dedicated full-fat cache service like the sports module would be
 * overkill. The helper exposes `wrap()` for cache-aside reads and a
 * `flushScope()` for bulk invalidation after admin writes.
 */

const PREFIX = 'fantasy';

const join = (...parts: Array<string | number | undefined | null>): string =>
  parts.filter((p) => p !== undefined && p !== null && p !== '').join(':');

export const FantasyCacheKeys = {
  activeRule: (sport: string, format: string): string =>
    join(PREFIX, 'rule', sport, format, 'active'),
  activeScoringRule: (sport: string, format: string): string =>
    join(PREFIX, 'scoring-rule', sport, format, 'active'),
  matchContext: (matchId: string): string => join(PREFIX, 'match', matchId, 'context'),
  userTeams: (userId: string, matchId: string): string =>
    join(PREFIX, 'user', userId, 'match', matchId, 'teams'),
  selectionsForPlayer: (matchId: string, playerId: string): string =>
    join(PREFIX, 'selections', matchId, playerId),
};

export const FantasyCacheTtl = AppConstants.FANTASY.CACHE_TTL;

export const fantasyCache = {
  wrap: cache.wrap.bind(cache),
  /**
   * Bulk-flush every key starting with `fantasy:<scope>`. Scope is a
   * prefix — pass `'rule'` to invalidate every active rule, `''` to nuke
   * the entire feature.
   */
  async flushScope(scope: '' | 'rule' | 'scoring-rule' | 'match' | 'user' | 'selections'): Promise<void> {
    if (!isRedisEnabled()) return;
    const pattern = scope ? `${PREFIX}:${scope}*` : `${PREFIX}:*`;
    try {
      const stream = redis.scanStream({ match: pattern, count: 200 });
      const keys: string[] = [];
      stream.on('data', (batch: string[]) => keys.push(...batch));
      await new Promise<void>((resolve, reject) => {
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err) {
      logger.warn({ err, pattern }, 'fantasy.cache.flush.failed');
    }
  },
};

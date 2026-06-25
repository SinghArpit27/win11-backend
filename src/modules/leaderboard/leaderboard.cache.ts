import { logger } from '@config/logger.config';
import { isRedisEnabled, redis } from '@config/redis.config';

import { AppConstants } from '@common/constants';
import { cache } from '@common/utils/cache.util';

/**
 * Cache wrapper for the leaderboard module (non-ZSET data).
 *
 * The sorted-set leaderboard itself lives in `leaderboard-redis.ts`;
 * this wrapper handles the **JSON projections** that decorate it:
 *  - rendered page snippets (top-N podium, per-page rows),
 *  - per-user rank summaries,
 *  - latest snapshot bundles for the FE,
 *  - rank-history time series.
 *
 * Same `wrap` + `flushScope` shape as the contest cache for
 * consistency — same operational tooling works for both.
 */

const PREFIX = 'leaderboard';

const join = (...parts: Array<string | number | undefined | null>): string =>
  parts.filter((p) => p !== undefined && p !== null && p !== '').join(':');

export const LeaderboardCacheKeys = {
  /** Rendered page of `25` entries for a contest. */
  contestPage: (contestId: string, page: number): string =>
    join(PREFIX, 'contest', contestId, 'page', page),
  /** Top-N podium. */
  contestTop: (contestId: string): string => join(PREFIX, 'contest', contestId, 'top'),
  /** Per-user rank summary inside a contest. */
  userRank: (contestId: string, userId: string): string =>
    join(PREFIX, 'contest', contestId, 'user', userId),
  /** A user's rank-history list for a contest. */
  rankHistory: (contestId: string, userId: string): string =>
    join(PREFIX, 'contest', contestId, 'history', userId),
  /** Recent score events. */
  matchScoreEvents: (matchId: string): string => join(PREFIX, 'match', matchId, 'score-events'),
};

export const LeaderboardCacheTtl = AppConstants.LEADERBOARD.CACHE_TTL;

type Scope =
  | ''
  | 'contest'
  | 'match'
  | 'top'
  | 'page'
  | 'user'
  | 'history';

export const leaderboardCache = {
  wrap: cache.wrap.bind(cache),

  /** Bulk-flush every leaderboard cache key matching `<scope>*`. */
  async flushScope(scope: Scope): Promise<void> {
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
      logger.warn({ err, pattern }, 'leaderboard.cache.flush.failed');
    }
  },

  /** Invalidate every cached projection for a single contest. */
  async invalidateContest(contestId: string): Promise<void> {
    if (!isRedisEnabled()) return;
    try {
      const stream = redis.scanStream({
        match: `${PREFIX}:contest:${contestId}*`,
        count: 200,
      });
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
      logger.warn({ err, contestId }, 'leaderboard.cache.invalidate.failed');
    }
  },
};

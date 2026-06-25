import { isRedisEnabled, redis } from '@config/redis.config';
import { logger } from '@config/logger.config';

import { AppConstants } from '@common/constants';
import { cache } from '@common/utils/cache.util';

/**
 * Lightweight Redis cache helper scoped to the contest module.
 *
 * Mirrors the fantasy module's approach — `wrap()` for cache-aside reads
 * + `flushScope()` for bulk invalidation after admin writes / joins.
 *
 *  Key shape: `contest:<scope>:<id-or-tuple>`
 *
 *  Hot scopes:
 *   - `list`            — paginated contest listings keyed by match.
 *   - `detail`          — single contest detail snapshots.
 *   - `participants`    — denormalised counter so the list/detail
 *                         endpoints can render spots-left without a
 *                         count() round-trip.
 *   - `template`        — admin template lookups.
 *   - `prize`           — admin prize-distribution lookups.
 */

const PREFIX = 'contest';

const join = (...parts: Array<string | number | undefined | null>): string =>
  parts.filter((p) => p !== undefined && p !== null && p !== '').join(':');

export const ContestCacheKeys = {
  listForMatch: (matchId: string, hash: string): string =>
    join(PREFIX, 'list', 'match', matchId, hash),
  detail: (contestId: string): string => join(PREFIX, 'detail', contestId),
  participantCount: (contestId: string): string =>
    join(PREFIX, 'participants', contestId),
  template: (templateId: string): string => join(PREFIX, 'template', templateId),
  prize: (distributionId: string): string => join(PREFIX, 'prize', distributionId),
};

export const ContestCacheTtl = AppConstants.CONTEST.CACHE_TTL;

type Scope = '' | 'list' | 'detail' | 'participants' | 'template' | 'prize';

export const contestCache = {
  wrap: cache.wrap.bind(cache),

  /**
   * Bulk-flush every key starting with `contest:<scope>`. Scope is a
   * prefix — pass `'detail'` to invalidate every detail snapshot, `''`
   * to nuke the entire feature.
   *
   * Falls back gracefully if Redis is unavailable — cache misses are
   * acceptable; lingering stale snapshots are not, but the next read
   * will refresh from the source of truth.
   */
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
      logger.warn({ err, pattern }, 'contest.cache.flush.failed');
    }
  },

  /** Invalidate everything tied to a single contest — detail + lists
   *  for its match + the participant counter. */
  async invalidateContest(contestId: string, matchId: string): Promise<void> {
    if (!isRedisEnabled()) return;
    const keys = [
      ContestCacheKeys.detail(contestId),
      ContestCacheKeys.participantCount(contestId),
    ];
    try {
      await redis.del(...keys);
      // Match-scoped list keys carry a hash suffix so we have to scan.
      await this.flushScope('list');
      // (Could narrow to `contest:list:match:<matchId>*` if list churn
      // becomes a hotspot — leaving as full scope for correctness.)
      void matchId;
    } catch (err) {
      logger.warn({ err, contestId, matchId }, 'contest.cache.invalidate.failed');
    }
  },
};

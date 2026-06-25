import { logger } from '@config/logger.config';
import { isRedisEnabled, redis } from '@config/redis.config';

import { cache } from '@common/utils/cache.util';

import { SportsCacheKeys, SportsCacheTtl } from './sports-cache.keys';

/**
 * Read-aside cache service for the sports module.
 *
 * Built on top of the generic `cache.wrap()` helper (Redis-backed,
 * stale-on-error semantics) but adds:
 *
 *  - typed key builders via `SportsCacheKeys`,
 *  - per-scope TTLs from `AppConstants.SPORTS.CACHE_TTL`,
 *  - scoped bulk-flush via SCAN-and-DEL (no `FLUSHDB` blast radius).
 *
 *  Why a dedicated service rather than calling `cache.wrap()` directly?
 *  → consumers (controllers, services, BullMQ jobs) get one cohesive
 *    surface, and we keep the cache *invalidation* logic close to the
 *    cache *population* logic. When a new key category is added, this is
 *    the only file the SR principle says must change.
 *
 *  Cache strategy:
 *  - **Cache-aside:** services call `wrap(key, ttl, loader)`. On hit we
 *    return the cached JSON; on miss the loader runs and the result is
 *    cached for `ttl` seconds. Loader exceptions bubble (do NOT cache
 *    failures — the next caller retries).
 *  - **Write-through invalidation:** ingestion calls `flushScope('matches')`
 *    when a sync completes so stale views vanish immediately.
 */
class SportsCacheService {
  // ─── Match reads ─────────────────────────────────────────────────────────

  matchDetail<T>(matchId: string, loader: () => Promise<T>): Promise<T> {
    return cache.wrap(SportsCacheKeys.matchDetail(matchId), SportsCacheTtl.MATCH_DETAIL, loader);
  }

  liveMatches<T>(sport: string | 'ALL', loader: () => Promise<T>): Promise<T> {
    return cache.wrap(SportsCacheKeys.liveMatches(sport), SportsCacheTtl.LIVE_MATCH, loader);
  }

  upcomingMatches<T>(sport: string | 'ALL', limit: number, loader: () => Promise<T>): Promise<T> {
    return cache.wrap(
      SportsCacheKeys.upcomingMatches(sport, limit),
      SportsCacheTtl.UPCOMING_MATCHES,
      loader,
    );
  }

  featuredMatches<T>(sport: string | 'ALL', loader: () => Promise<T>): Promise<T> {
    return cache.wrap(
      SportsCacheKeys.featuredMatches(sport),
      SportsCacheTtl.FEATURED_MATCHES,
      loader,
    );
  }

  trendingMatches<T>(sport: string | 'ALL', loader: () => Promise<T>): Promise<T> {
    return cache.wrap(
      SportsCacheKeys.trendingMatches(sport),
      SportsCacheTtl.TRENDING_MATCHES,
      loader,
    );
  }

  // ─── Player / Team / Tournament reads ────────────────────────────────────

  playerProfile<T>(playerId: string, loader: () => Promise<T>): Promise<T> {
    return cache.wrap(
      SportsCacheKeys.playerProfile(playerId),
      SportsCacheTtl.PLAYER_PROFILE,
      loader,
    );
  }

  playerStats<T>(playerId: string, loader: () => Promise<T>): Promise<T> {
    return cache.wrap(
      SportsCacheKeys.playerStats(playerId),
      SportsCacheTtl.PLAYER_STATS,
      loader,
    );
  }

  teamProfile<T>(teamId: string, loader: () => Promise<T>): Promise<T> {
    return cache.wrap(SportsCacheKeys.teamProfile(teamId), SportsCacheTtl.TEAM_PROFILE, loader);
  }

  tournamentList<T>(sport: string | 'ALL', loader: () => Promise<T>): Promise<T> {
    return cache.wrap(
      SportsCacheKeys.tournamentList(sport),
      SportsCacheTtl.TOURNAMENT_LIST,
      loader,
    );
  }

  // ─── Invalidation ────────────────────────────────────────────────────────

  /** Drop a single cached value (e.g. after admin toggles featured flag). */
  async invalidateMatch(matchId: string): Promise<void> {
    await cache.del([
      SportsCacheKeys.matchDetail(matchId),
      SportsCacheKeys.liveMatches('ALL'),
      SportsCacheKeys.featuredMatches('ALL'),
      SportsCacheKeys.trendingMatches('ALL'),
    ]);
  }

  /**
   * SCAN-based bulk flush. Safe in production (non-blocking, no FLUSHDB).
   * Returns the number of keys deleted for observability.
   */
  async flushScope(scope: 'all' | 'matches' | 'players' | 'teams' | 'tournaments'): Promise<number> {
    if (!isRedisEnabled()) return 0;
    const pattern = SportsCacheKeys.scopePattern(scope);
    let deleted = 0;
    try {
      const stream = redis.scanStream({ match: pattern, count: 100 });
      const batches: string[][] = [];
      for await (const keys of stream as AsyncIterable<string[]>) {
        if (keys.length) batches.push(keys);
      }
      for (const batch of batches) {
        await redis.del(...batch);
        deleted += batch.length;
      }
      logger.info({ event: 'sports.cache.flush', scope, deleted }, 'Sports cache scope flushed');
    } catch (err) {
      logger.warn({ err, scope }, 'sports.cache.flush failed');
    }
    return deleted;
  }
}

export const sportsCacheService = new SportsCacheService();
export { SportsCacheService };

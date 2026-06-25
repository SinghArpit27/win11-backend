import { logger } from '@config/logger.config';
import { isRedisEnabled, redis } from '@config/redis.config';

import { AppConstants } from '@common/constants';
import { LeaderboardScope } from '@common/enums';

/**
 * Thin, typed wrapper around Redis sorted-set operations used by the
 * leaderboard module.
 *
 * **Why a wrapper?**
 * - `ioredis` is stringly-typed (returns `string[]` for `zrevrange`),
 *   the wrapper hands the rest of the codebase strongly-typed records.
 * - Every read path falls back to `null` / empty array on a Redis
 *   error so a Redis outage degrades to "stale leaderboard" instead of
 *   a hard 5xx.
 * - Score precision conversion (float points → integer sorted-set
 *   score) lives here so the rest of the engine never sees the
 *   `* 100` arithmetic.
 *
 * **Sorted-set design**
 * - Member: `entryId` (string). For CONTEST scope this is the contest
 *   entry; for MATCH scope it's the fantasy team.
 * - Score:  `points * 10^SCORE_PRECISION`. Rounding once at write keeps
 *   the score deterministic even with float drift.
 * - Tie break: Redis natively orders ties by lexical member id, which
 *   for ObjectId means "older entry wins". That matches the platform
 *   convention "earliest joiner wins ties", so no secondary structure
 *   is needed.
 */

const SCORE_PRECISION_FACTOR = 10 ** AppConstants.LEADERBOARD.SCORE_PRECISION;

export const toRedisScore = (points: number): number =>
  Math.round(points * SCORE_PRECISION_FACTOR);

export const fromRedisScore = (score: number): number =>
  Math.round(score) / SCORE_PRECISION_FACTOR;

const buildKey = (scope: LeaderboardScope, scopeId: string): string =>
  `leaderboard:${scope.toLowerCase()}:${scopeId}`;

export interface LeaderboardZsetEntry {
  entryId: string;
  /** Already converted back to fantasy-point units. */
  points: number;
  /** 1-based rank inside the ZSET (`null` if member missing). */
  rank: number | null;
}

class LeaderboardRedis {
  /**
   * Replace every member of a leaderboard with the supplied list. Uses
   * a pipeline (`DEL` + `ZADD`) so the cutover is near-atomic; reads
   * during the cutover may see partial data but the next refresh will
   * heal.
   */
  async rebuild(
    scope: LeaderboardScope,
    scopeId: string,
    entries: Array<{ entryId: string; points: number }>,
  ): Promise<{ totalEntries: number }> {
    if (!isRedisEnabled()) return { totalEntries: entries.length };
    const key = buildKey(scope, scopeId);
    try {
      const pipeline = redis.pipeline();
      pipeline.del(key);
      if (entries.length > 0) {
        // Build `[score, member, score, member, ...]` payload for ZADD
        const args: (string | number)[] = [];
        for (const e of entries) {
          args.push(toRedisScore(e.points), e.entryId);
        }
        pipeline.zadd(key, ...(args as [number, string]));
      }
      await pipeline.exec();
      return { totalEntries: entries.length };
    } catch (err) {
      logger.error({ err, scope, scopeId }, '[Leaderboard] rebuild failed');
      throw err;
    }
  }

  /**
   * Incremental update for a single member. Used by the live tick
   * worker to avoid a full rebuild on every score change.
   */
  async upsert(
    scope: LeaderboardScope,
    scopeId: string,
    entryId: string,
    points: number,
  ): Promise<void> {
    if (!isRedisEnabled()) return;
    const key = buildKey(scope, scopeId);
    try {
      await redis.zadd(key, toRedisScore(points), entryId);
    } catch (err) {
      logger.error({ err, scope, scopeId, entryId }, '[Leaderboard] upsert failed');
    }
  }

  /** Remove a member (used when an entry is REFUNDED / CANCELLED). */
  async remove(scope: LeaderboardScope, scopeId: string, entryId: string): Promise<void> {
    const key = buildKey(scope, scopeId);
    try {
      await redis.zrem(key, entryId);
    } catch (err) {
      logger.error({ err, scope, scopeId, entryId }, '[Leaderboard] remove failed');
    }
  }

  /** Total members in the leaderboard. */
  async size(scope: LeaderboardScope, scopeId: string): Promise<number> {
    try {
      const n = await redis.zcard(buildKey(scope, scopeId));
      return n ?? 0;
    } catch (err) {
      logger.error({ err, scope, scopeId }, '[Leaderboard] size failed');
      return 0;
    }
  }

  /**
   * Paginated descending range. `from`/`to` are 0-based inclusive
   * indices (i.e. `from=0,to=24` returns the top 25).
   */
  async range(
    scope: LeaderboardScope,
    scopeId: string,
    from: number,
    to: number,
  ): Promise<LeaderboardZsetEntry[]> {
    const key = buildKey(scope, scopeId);
    try {
      const raw = await redis.zrevrange(key, from, to, 'WITHSCORES');
      const out: LeaderboardZsetEntry[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        const entryId = raw[i];
        const score = Number(raw[i + 1]);
        if (!entryId) continue;
        out.push({
          entryId,
          points: fromRedisScore(score),
          rank: from + 1 + out.length,
        });
      }
      return out;
    } catch (err) {
      logger.error({ err, scope, scopeId, from, to }, '[Leaderboard] range failed');
      return [];
    }
  }

  /** Look up a member's rank + score in one round-trip. */
  async getRank(
    scope: LeaderboardScope,
    scopeId: string,
    entryId: string,
  ): Promise<LeaderboardZsetEntry | null> {
    const key = buildKey(scope, scopeId);
    try {
      const [rank, score] = await Promise.all([
        redis.zrevrank(key, entryId),
        redis.zscore(key, entryId),
      ]);
      if (rank === null || score === null) return null;
      return {
        entryId,
        points: fromRedisScore(Number(score)),
        rank: rank + 1,
      };
    } catch (err) {
      logger.error({ err, scope, scopeId, entryId }, '[Leaderboard] getRank failed');
      return null;
    }
  }

  /** Bulk-fetch ranks for several members — used by `My Contests`. */
  async getRanks(
    scope: LeaderboardScope,
    scopeId: string,
    entryIds: string[],
  ): Promise<Map<string, LeaderboardZsetEntry>> {
    const out = new Map<string, LeaderboardZsetEntry>();
    if (entryIds.length === 0) return out;
    const key = buildKey(scope, scopeId);
    try {
      const pipeline = redis.pipeline();
      for (const id of entryIds) {
        pipeline.zrevrank(key, id);
        pipeline.zscore(key, id);
      }
      const results = await pipeline.exec();
      if (!results) return out;
      for (let i = 0; i < entryIds.length; i += 1) {
        const rankRes = results[i * 2];
        const scoreRes = results[i * 2 + 1];
        if (!rankRes || !scoreRes) continue;
        const rank = rankRes[1] as number | null;
        const score = scoreRes[1] as string | null;
        if (rank === null || score === null) continue;
        out.set(entryIds[i]!, {
          entryId: entryIds[i]!,
          rank: rank + 1,
          points: fromRedisScore(Number(score)),
        });
      }
      return out;
    } catch (err) {
      logger.error({ err, scope, scopeId, ids: entryIds.length }, '[Leaderboard] getRanks failed');
      return out;
    }
  }

  /** Drop the ZSET — used when a contest is cancelled. */
  async drop(scope: LeaderboardScope, scopeId: string): Promise<void> {
    const key = buildKey(scope, scopeId);
    try {
      await redis.del(key);
    } catch (err) {
      logger.error({ err, scope, scopeId }, '[Leaderboard] drop failed');
    }
  }
}

export const leaderboardRedis = new LeaderboardRedis();
export { LeaderboardRedis };

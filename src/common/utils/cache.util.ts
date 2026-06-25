import { logger } from '@config/logger.config';
import { isRedisEnabled, redis } from '@config/redis.config';

import { AppConstants } from '@common/constants';

/**
 * Lightweight cache helper around Redis.
 * - JSON serialised values.
 * - Stale-on-error policy: failures are logged, never thrown, so a Redis
 *   outage degrades to "no cache" instead of breaking the request.
 */
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    if (!isRedisEnabled()) return null;
    try {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      logger.warn({ err, key }, 'cache.get failed');
      return null;
    }
  },

  async set<T>(key: string, value: T, ttlSeconds = AppConstants.CACHE_TTL.MEDIUM): Promise<void> {
    if (!isRedisEnabled()) return;
    try {
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      logger.warn({ err, key }, 'cache.set failed');
    }
  },

  async del(key: string | string[]): Promise<void> {
    if (!isRedisEnabled()) return;
    try {
      const keys = Array.isArray(key) ? key : [key];
      if (keys.length) await redis.del(...keys);
    } catch (err) {
      logger.warn({ err, key }, 'cache.del failed');
    }
  },

  async wrap<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await cache.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await loader();
    await cache.set(key, fresh, ttlSeconds);
    return fresh;
  },
};

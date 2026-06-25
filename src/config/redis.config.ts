import Redis, { Redis as RedisClient, RedisOptions } from 'ioredis';

import { env } from './env.config';
import { logger } from './logger.config';

/**
 * Centralised Redis client factory.
 *
 * Two distinct clients are created:
 * - `redis`     : default app client (caching, rate limit, pub/sub publisher).
 * - `bullRedis` : dedicated client for BullMQ (no `maxRetriesPerRequest` so
 *                 long-poll BRPOPLPUSH semantics work correctly).
 *
 * Connection precedence:
 *  1. `REDIS_URL` (e.g. `redis://...` or `rediss://...` for TLS) — recommended
 *     for managed providers like Upstash / Redis Cloud.
 *  2. Discrete host / port / password / db variables — for self-hosted.
 */

const sharedOptions: RedisOptions = {
  // When Redis is disabled we never call connect — avoids Upstash quota errors
  // blocking local API boot when only Mongo is needed.
  lazyConnect: !env.REDIS_ENABLED,
  enableReadyCheck: env.REDIS_ENABLED,
  retryStrategy: env.REDIS_ENABLED ? (times) => Math.min(times * 200, 5_000) : () => null,
};

const appOptions: RedisOptions = {
  ...sharedOptions,
  keyPrefix: env.REDIS_KEY_PREFIX,
};

const bullOptions: RedisOptions = {
  ...sharedOptions,
  // BullMQ manages its own keyspace via the queue `prefix` option.
  keyPrefix: undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const buildClient = (overrides: RedisOptions): RedisClient => {
  if (env.REDIS_URL) {
    // `rediss://` URLs auto-enable TLS via ioredis URL parsing.
    return new Redis(env.REDIS_URL, overrides);
  }
  return new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    username: env.REDIS_USERNAME || undefined,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    // Empty object enables TLS with sensible defaults (matches managed Redis
    // providers like Upstash / Redis Cloud that require it).
    ...(env.REDIS_TLS ? { tls: {} } : {}),
    ...overrides,
  });
};

export const redis: RedisClient = buildClient(appOptions);
export const bullRedis: RedisClient = buildClient(bullOptions);

/** True when Redis is configured and expected to be reachable at boot. */
export const isRedisEnabled = (): boolean => env.REDIS_ENABLED;

const wireEvents = (client: RedisClient, label: string) => {
  if (!env.REDIS_ENABLED) return;
  client.on('connect', () => logger.info({ event: 'redis.connect', label }, `${label} connecting`));
  client.on('ready', () => logger.info({ event: 'redis.ready', label }, `${label} ready`));
  client.on('error', (err) =>
    logger.error({ event: 'redis.error', label, err }, `${label} error: ${err.message}`),
  );
  client.on('end', () => logger.warn({ event: 'redis.end', label }, `${label} connection closed`));
};

wireEvents(redis, 'redis');
wireEvents(bullRedis, 'bullRedis');

export const disconnectRedis = async (): Promise<void> => {
  if (!env.REDIS_ENABLED) return;
  await Promise.allSettled([redis.quit(), bullRedis.quit()]);
};

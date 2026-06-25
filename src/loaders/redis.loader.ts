import { logger } from '@config/logger.config';
import { disconnectRedis, isRedisEnabled, redis } from '@config/redis.config';

export const initRedis = async (): Promise<void> => {
  if (!isRedisEnabled()) {
    logger.info({ event: 'loader.redis.skipped' }, 'Redis disabled — skipping ping');
    return;
  }
  // ioredis connects eagerly; a PING confirms readiness before traffic flows.
  await redis.ping();
  logger.info({ event: 'loader.redis' }, 'Redis loader initialised');
};

export const shutdownRedis = async (): Promise<void> => {
  await disconnectRedis();
};

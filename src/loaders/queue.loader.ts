import { logger } from '@config/logger.config';
import { isRedisEnabled } from '@config/redis.config';

import { initQueues, shutdownQueues } from '@queues/index';

export const initQueueLayer = async (): Promise<void> => {
  if (!isRedisEnabled()) {
    logger.info({ event: 'loader.queues.skipped' }, 'Redis disabled — skipping BullMQ queues');
    return;
  }
  await initQueues();
  logger.info({ event: 'loader.queues' }, 'Queue loader initialised');
};

export const shutdownQueueLayer = async (): Promise<void> => {
  if (!isRedisEnabled()) return;
  await shutdownQueues();
};

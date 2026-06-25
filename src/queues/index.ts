import { logger } from '@config/logger.config';

import { QueueName } from '@common/enums';

import { closeAllQueues, getQueue } from './queue.factory';

/**
 * Pre-creates every queue at startup so producers don't pay the construction
 * cost on the first job and workers can rely on the queue keyspace existing.
 *
 * PHASE 1 only declares the queues — actual workers ship with their owning
 * features in later phases.
 */
export const initQueues = async (): Promise<void> => {
  Object.values(QueueName).forEach((name) => getQueue(name));
  logger.info({ event: 'queues.init', queues: Object.values(QueueName) }, 'Queues initialised');
};

export const shutdownQueues = async (): Promise<void> => {
  await closeAllQueues();
};

export * from './queue.factory';

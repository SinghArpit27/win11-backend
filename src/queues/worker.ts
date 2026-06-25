/**
 * Standalone worker entrypoint.
 *
 * Spin up with `npm run start:worker` (or via the `worker` service in
 * docker-compose). Keeping queue processing in a separate process protects
 * the API event loop from heavy jobs.
 *
 * PHASE 1: the worker process boots Redis + database, registers nothing,
 * and waits — feature workers attach themselves in later phases.
 */
import { logger } from '@config/logger.config';

import { initDatabase, shutdownDatabase } from '@loaders/database.loader';
import { initRedis, shutdownRedis } from '@loaders/redis.loader';

import { shutdownQueues } from '@queues/index';

const bootstrapWorker = async (): Promise<void> => {
  await initDatabase();
  await initRedis();
  logger.info('Worker process ready');
};

const shutdown = async (signal: string): Promise<void> => {
  logger.warn({ signal }, 'Worker shutting down');
  await shutdownQueues();
  await shutdownRedis();
  await shutdownDatabase();
  process.exit(0);
};

['SIGINT', 'SIGTERM'].forEach((s) =>
  process.on(s, () => {
    void shutdown(s);
  }),
);

bootstrapWorker().catch((err) => {
  logger.error({ err }, 'Worker failed to start');
  process.exit(1);
});

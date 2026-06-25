import { Job, JobsOptions, Queue, QueueEvents, Worker, WorkerOptions } from 'bullmq';

import { env } from '@config/env.config';
import { logger } from '@config/logger.config';
import { bullRedis } from '@config/redis.config';

import { QueueName } from '@common/enums';

/**
 * Generic BullMQ factory.
 *
 * - One queue instance per queue name (singleton via registry).
 * - Centralised default `JobsOptions`: retries with exponential backoff +
 *   auto-clean on completion/failure to keep Redis lean.
 * - Workers register through `registerWorker` so every job inherits the
 *   same observability hooks.
 */

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { count: 1_000, age: 60 * 60 * 24 },
  removeOnFail: { count: 5_000, age: 60 * 60 * 24 * 7 },
};

const queueRegistry = new Map<QueueName, Queue>();
const workerRegistry = new Map<QueueName, Worker>();
const eventsRegistry = new Map<QueueName, QueueEvents>();

export const getQueue = <T = unknown>(name: QueueName): Queue<T> => {
  let q = queueRegistry.get(name) as Queue<T> | undefined;
  if (!q) {
    q = new Queue<T>(name, {
      connection: bullRedis,
      prefix: env.BULLMQ_PREFIX,
      defaultJobOptions,
    });
    queueRegistry.set(name, q as unknown as Queue);
  }
  return q;
};

export type QueueProcessor<T = unknown, R = unknown> = (job: Job<T, R>) => Promise<R>;

export const registerWorker = <T = unknown, R = unknown>(
  name: QueueName,
  processor: QueueProcessor<T, R>,
  options: Omit<WorkerOptions, 'connection' | 'prefix'> = {},
): Worker<T, R> => {
  const existing = workerRegistry.get(name);
  if (existing) return existing as unknown as Worker<T, R>;

  const worker = new Worker<T, R>(name, processor, {
    connection: bullRedis,
    prefix: env.BULLMQ_PREFIX,
    concurrency: 10,
    ...options,
  });

  worker.on('failed', (job, err) =>
    logger.error({ queue: name, jobId: job?.id, err }, 'Worker job failed'),
  );
  worker.on('error', (err) => logger.error({ queue: name, err }, 'Worker error'));

  workerRegistry.set(name, worker as unknown as Worker);
  return worker;
};

export const getQueueEvents = (name: QueueName): QueueEvents => {
  let e = eventsRegistry.get(name);
  if (!e) {
    e = new QueueEvents(name, { connection: bullRedis, prefix: env.BULLMQ_PREFIX });
    eventsRegistry.set(name, e);
  }
  return e;
};

export const closeAllQueues = async (): Promise<void> => {
  await Promise.allSettled([
    ...[...queueRegistry.values()].map((q) => q.close()),
    ...[...workerRegistry.values()].map((w) => w.close()),
    ...[...eventsRegistry.values()].map((e) => e.close()),
  ]);
  queueRegistry.clear();
  workerRegistry.clear();
  eventsRegistry.clear();
};

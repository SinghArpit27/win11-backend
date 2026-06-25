import { logger } from '@config/logger.config';
import { isRedisEnabled } from '@config/redis.config';

import { QueueName } from '@common/enums';

import { eventBus, redisPublisher, deadLetterService, type RealtimeDispatchJob } from '@events/index';
import { socketGateway } from '@sockets/socket-gateway.service';
import { getQueue, registerWorker } from '@queues/queue.factory';

/**
 * BullMQ worker: REALTIME_DISPATCH → Redis pub/sub.
 * API subscriber forwards to SocketGateway.
 */
export const initRealtimeJobs = async (): Promise<void> => {
  eventBus.registerLocalDispatch(async (envelope) => {
    await socketGateway.dispatch(envelope);
  });

  if (!isRedisEnabled()) {
    logger.info({ event: 'realtime.jobs.skipped' }, 'Redis disabled — realtime worker not registered');
    return;
  }

  registerWorker<RealtimeDispatchJob>(
    QueueName.REALTIME_DISPATCH,
    async (job) => {
      await redisPublisher.publish(job.data);
    },
    { concurrency: 20 },
  );

  logger.info({ event: 'realtime.jobs.ready' }, 'Realtime dispatch worker registered');
};

export const getRealtimeQueueDepth = async (): Promise<number> => {
  if (!isRedisEnabled()) return 0;
  const counts = await getQueue(QueueName.REALTIME_DISPATCH).getJobCounts(
    'waiting',
    'active',
    'delayed',
    'failed',
  );
  return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.failed ?? 0);
};

export const getNotificationQueueMetrics = async () => {
  if (!isRedisEnabled()) {
    return { waiting: 0, active: 0, failed: 0 };
  }
  const counts = await getQueue(QueueName.NOTIFICATION).getJobCounts('waiting', 'active', 'failed');
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    failed: counts.failed ?? 0,
  };
};

export const getDeadLetterCount = async (): Promise<number> => deadLetterService.count();

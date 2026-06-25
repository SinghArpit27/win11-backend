import Redis from 'ioredis';

import { env } from '@config/env.config';
import { logger } from '@config/logger.config';
import { isRedisEnabled } from '@config/redis.config';

import { REALTIME_REDIS_CHANNEL } from './event.registry';
import type { RealtimeEnvelope } from './event.contracts';
import { deadLetterService } from './dead-letter.service';
import { realtimeMetrics } from './realtime-metrics.service';

type DispatchHandler = (envelope: RealtimeEnvelope) => void | Promise<void>;

let subscriber: Redis | null = null;
let dispatchHandler: DispatchHandler | null = null;

const buildSubscriberClient = (): Redis => {
  if (env.REDIS_URL) {
    return new Redis(env.REDIS_URL, {
      keyPrefix: env.REDIS_KEY_PREFIX,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    username: env.REDIS_USERNAME || undefined,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    ...(env.REDIS_TLS ? { tls: {} } : {}),
    keyPrefix: env.REDIS_KEY_PREFIX,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
};

export const initRedisSubscriber = async (handler: DispatchHandler): Promise<void> => {
  if (!isRedisEnabled()) {
    logger.info({ event: 'realtime.subscriber.skipped' }, 'Redis disabled — subscriber not started');
    return;
  }
  if (subscriber) return;

  dispatchHandler = handler;
  subscriber = buildSubscriberClient();

  subscriber.on('message', async (_channel, message) => {
    try {
      const envelope = JSON.parse(message) as RealtimeEnvelope;
      await dispatchHandler?.(envelope);
      realtimeMetrics.recordDelivered();
    } catch (err) {
      logger.error({ err }, 'Failed to handle realtime pub/sub message');
      try {
        const envelope = JSON.parse(message) as RealtimeEnvelope;
        await deadLetterService.push(envelope, err instanceof Error ? err.message : 'dispatch_failed');
      } catch {
        realtimeMetrics.recordFailed();
      }
    }
  });

  await subscriber.subscribe(REALTIME_REDIS_CHANNEL);
  logger.info({ event: 'realtime.subscriber.ready', channel: REALTIME_REDIS_CHANNEL }, 'Redis subscriber ready');
};

export const shutdownRedisSubscriber = async (): Promise<void> => {
  if (!subscriber) return;
  await subscriber.unsubscribe(REALTIME_REDIS_CHANNEL).catch(() => undefined);
  await subscriber.quit().catch(() => undefined);
  subscriber = null;
  dispatchHandler = null;
};

import { randomUUID } from 'node:crypto';

import { logger } from '@config/logger.config';
import { isRedisEnabled, redis } from '@config/redis.config';

import { REALTIME_REDIS_CHANNEL } from './event.registry';
import type { RealtimeEnvelope } from './event.contracts';
import { realtimeMetrics } from './realtime-metrics.service';

/**
 * Publishes validated realtime envelopes to the Redis pub/sub channel.
 */
class RedisPublisherService {
  async publish(envelope: RealtimeEnvelope): Promise<void> {
    if (!isRedisEnabled()) return;

    const payload = JSON.stringify(envelope);
    await redis.publish(REALTIME_REDIS_CHANNEL, payload);
    realtimeMetrics.recordPublished();
    logger.debug(
      { event: 'realtime.publish', name: envelope.event, target: envelope.target },
      'Realtime event published',
    );
  }
}

export const redisPublisher = new RedisPublisherService();

export const buildEnvelope = <TPayload>(
  event: RealtimeEnvelope['event'],
  target: RealtimeEnvelope['target'],
  payload: TPayload,
  correlationId?: string,
): RealtimeEnvelope<TPayload> => ({
  v: 1,
  id: randomUUID(),
  event,
  target,
  payload,
  occurredAt: new Date().toISOString(),
  correlationId,
});

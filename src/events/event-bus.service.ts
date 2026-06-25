import { logger } from '@config/logger.config';
import { isRedisEnabled } from '@config/redis.config';

import { QueueName } from '@common/enums';

import { getQueue } from '@queues/queue.factory';

import type { RealtimeEnvelope } from './event.contracts';
import { buildEnvelope, redisPublisher } from './redis-publisher.service';
import { deadLetterService } from './dead-letter.service';

export type RealtimeDispatchJob = RealtimeEnvelope;

/**
 * Event bus — single entry point for domain modules.
 *
 * Flow:
 *   service → eventBus.publish() → BullMQ (when Redis enabled)
 *          → worker → Redis pub/sub → socket gateway
 *
 * When Redis is disabled, publishes directly to the in-process gateway
 * so local dev remains functional without BullMQ.
 */
class EventBusService {
  private localDispatch: ((envelope: RealtimeEnvelope) => Promise<void>) | null = null;

  registerLocalDispatch(handler: (envelope: RealtimeEnvelope) => Promise<void>): void {
    this.localDispatch = handler;
  }

  async publish(envelope: RealtimeEnvelope): Promise<void> {
    try {
      if (!isRedisEnabled()) {
        if (this.localDispatch) {
          await this.localDispatch(envelope);
        }
        return;
      }

      const queue = getQueue<RealtimeDispatchJob>(QueueName.REALTIME_DISPATCH);
      await queue.add('dispatch', envelope, {
        jobId: envelope.id,
        removeOnComplete: true,
      });
    } catch (err) {
      logger.error({ err, event: envelope.event }, 'Event bus publish failed');
      await deadLetterService.push(
        envelope,
        err instanceof Error ? err.message : 'event_bus_publish_failed',
      );
    }
  }

  async publishBuilt<TPayload>(
    event: RealtimeEnvelope['event'],
    target: RealtimeEnvelope['target'],
    payload: TPayload,
    correlationId?: string,
  ): Promise<void> {
    await this.publish(buildEnvelope(event, target, payload, correlationId));
  }
}

export const eventBus = new EventBusService();

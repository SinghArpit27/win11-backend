import { logger } from '@config/logger.config';
import { isRedisEnabled, redis } from '@config/redis.config';

import { REALTIME_DEAD_LETTER_KEY } from './event.registry';
import type { RealtimeEnvelope } from './event.contracts';
import { realtimeMetrics } from './realtime-metrics.service';

const MAX_DEAD_LETTERS = 500;

/**
 * Stores failed realtime dispatches for admin inspection / replay.
 */
class DeadLetterService {
  async push(envelope: RealtimeEnvelope, reason: string): Promise<void> {
    realtimeMetrics.recordFailed();
    const entry = JSON.stringify({
      envelope,
      reason,
      failedAt: new Date().toISOString(),
    });

    if (!isRedisEnabled()) {
      logger.error({ event: 'realtime.dead_letter', reason, envelope }, 'Realtime dead letter');
      return;
    }

    try {
      await redis
        .multi()
        .lpush(REALTIME_DEAD_LETTER_KEY, entry)
        .ltrim(REALTIME_DEAD_LETTER_KEY, 0, MAX_DEAD_LETTERS - 1)
        .exec();
    } catch (err) {
      logger.error({ err, reason }, 'Failed to persist realtime dead letter');
    }
  }

  async list(limit = 50): Promise<Array<{ envelope: RealtimeEnvelope; reason: string; failedAt: string }>> {
    if (!isRedisEnabled()) return [];
    const rows = await redis.lrange(REALTIME_DEAD_LETTER_KEY, 0, limit - 1);
    return rows.map((row) => JSON.parse(row) as { envelope: RealtimeEnvelope; reason: string; failedAt: string });
  }

  async count(): Promise<number> {
    if (!isRedisEnabled()) return 0;
    return redis.llen(REALTIME_DEAD_LETTER_KEY);
  }
}

export const deadLetterService = new DeadLetterService();

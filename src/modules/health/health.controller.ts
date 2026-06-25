import type { Request, Response } from 'express';

import { isDatabaseConnected } from '@config/database.config';
import { env } from '@config/env.config';
import { isRedisEnabled, redis } from '@config/redis.config';

import { asyncHandler, sendSuccess } from '@common/utils';

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Liveness + readiness probe
 *     description: Returns service version + connection status of MongoDB and Redis.
 *     responses:
 *       200:
 *         description: Service is healthy
 */
export const getHealth = asyncHandler(async (_req: Request, res: Response) => {
  const startedAt = Date.now();
  const redisOk = isRedisEnabled()
    ? await redis
        .ping()
        .then(() => true)
        .catch(() => false)
    : false;

  return sendSuccess(res, {
    status: 'ok',
    app: env.APP_NAME,
    version: env.APP_VERSION,
    env: env.NODE_ENV,
    uptime: process.uptime(),
    checks: {
      database: { ok: isDatabaseConnected() },
      redis: { ok: redisOk },
    },
    latencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
});

import type { NextFunction, Request, Response } from 'express';

import { logger } from '@config/logger.config';

import { AppConstants } from '@common/constants';

/**
 * Structured request logger. Emits a single log line per request lifecycle.
 *
 * Routes >= 400 escalate to `warn`, >= 500 to `error`, so log filters can
 * fan-out alerts without inspecting payloads.
 *
 * `Authorization`, cookies, and other secrets are already redacted by the
 * root Pino instance — no need to re-redact here.
 *
 * Heavy metrics / Prometheus exposition belong in a dedicated middleware
 * (PHASE 10 monitoring).
 */
export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  res.on('finish', () => {
    const duration = req.startedAt ? Date.now() - req.startedAt : 0;
    const level =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level](
      {
        requestId: req.id,
        correlationId: req.correlationId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: duration,
        userId: req.user?.id,
        userRoles: req.user?.roles,
        ip: req.ip,
        platform: req.header(AppConstants.CLIENT_PLATFORM_HEADER),
        appVersion: req.header(AppConstants.CLIENT_VERSION_HEADER),
        userAgent: req.header('user-agent'),
      },
      'http.request',
    );
  });
  next();
};

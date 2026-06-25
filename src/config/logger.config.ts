import pino, { Logger } from 'pino';

import { env, isDevelopment } from './env.config';

/**
 * Application logger built on Pino.
 * Pretty output in dev; JSON in production for log aggregation.
 */
export const logger: Logger = pino({
  name: env.APP_NAME,
  level: env.LOG_LEVEL,
  base: { service: env.APP_NAME, version: env.APP_VERSION, env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'accessToken',
      'refreshToken',
      '*.password',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

export const createChildLogger = (bindings: Record<string, unknown>): Logger =>
  logger.child(bindings);

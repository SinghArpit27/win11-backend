import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Application } from 'express';
import mongoSanitize from 'express-mongo-sanitize';
import helmet from 'helmet';
import hpp from 'hpp';
import morgan from 'morgan';
// @ts-expect-error - xss-clean has no published types
import xss from 'xss-clean';

import { env, isDevelopment } from '@config/env.config';

import {
  errorHandler,
  globalRateLimiter,
  notFoundHandler,
  requestIdMiddleware,
  requestLoggerMiddleware,
} from '@common/middlewares';

import { registerRoutes } from './routes.loader';

/**
 * Builds the Express application with all global middlewares wired in a
 * deterministic, security-first order. No business logic lives here.
 */
export const buildExpressApp = (): Application => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  // ─── Security & hardening ───────────────────────────────────────────────
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    }),
  );
  app.use(hpp());
  app.use(mongoSanitize());
  app.use(xss());

  // ─── Body parsers ───────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(compression());

  // ─── Observability ──────────────────────────────────────────────────────
  app.use(requestIdMiddleware);
  if (env.ENABLE_REQUEST_LOGS) {
    app.use(requestLoggerMiddleware);
    if (isDevelopment) app.use(morgan('dev'));
  }

  // ─── Rate limiting ──────────────────────────────────────────────────────
  app.use(globalRateLimiter);

  // ─── Feature routes + docs ──────────────────────────────────────────────
  registerRoutes(app);

  // ─── 404 + global error handler MUST come last ──────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

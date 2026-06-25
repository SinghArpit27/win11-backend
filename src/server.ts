import http from 'node:http';

import { env } from '@config/env.config';
import { logger } from '@config/logger.config';

import { bootstrapLoaders, shutdownLoaders } from '@loaders/index';

import { app } from './app';

/**
 * Production-grade bootstrap.
 * 1. Build HTTP server around the Express app.
 * 2. Initialise loaders (DB, Redis, queues, sockets) BEFORE accepting traffic.
 * 3. Begin listening only on success.
 * 4. Trap signals + unhandled errors for graceful shutdown.
 */

const httpServer = http.createServer(app);

const shutdown = async (signal: string, code = 0): Promise<void> => {
  logger.warn({ signal }, 'Graceful shutdown initiated');
  const forceTimer = setTimeout(() => {
    logger.error('Forced exit — shutdown took too long');
    process.exit(1);
  }, 15_000);
  forceTimer.unref();

  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await shutdownLoaders();
  logger.info('Shutdown complete');
  process.exit(code);
};

const start = async (): Promise<void> => {
  try {
    await bootstrapLoaders(httpServer);

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.fatal(
          { port: env.PORT, err },
          `Port ${env.PORT} is already in use — stop the other dev server or set a different PORT in .env`,
        );
        process.exit(1);
        return;
      }
      logger.fatal({ err }, 'HTTP server error');
      process.exit(1);
    });

    httpServer.listen(env.PORT, () => {
      logger.info(
        { port: env.PORT, env: env.NODE_ENV, apiPrefix: env.API_PREFIX },
        `${env.APP_NAME} listening on :${env.PORT}`,
      );
    });
  } catch (err) {
    logger.fatal({ err }, 'Fatal startup error');
    process.exit(1);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  void shutdown('uncaughtException', 1);
});

void start();

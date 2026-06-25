import type { Server as HttpServer } from 'node:http';

import { logger } from '@config/logger.config';

import { initSocketServer, shutdownSocketServer } from '@sockets/socket.server';

export const initSockets = async (httpServer: HttpServer): Promise<void> => {
  await initSocketServer(httpServer);
  logger.info({ event: 'loader.sockets' }, 'Socket.io loader initialised');
};

export const shutdownSockets = async (): Promise<void> => {
  await shutdownSocketServer();
};

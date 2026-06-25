import type { Server as HttpServer } from 'node:http';

import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server as IOServer, Socket } from 'socket.io';

import { env } from '@config/env.config';
import { logger } from '@config/logger.config';
import { isRedisEnabled } from '@config/redis.config';

import { SocketEvent, SocketNamespace } from '@common/enums';

import { eventBus, initRedisSubscriber, shutdownRedisSubscriber } from '@events/index';
import { verifyAccessToken } from '@common/utils/jwt.util';

import { registerRoomHandlers } from './handlers/room.handler';
import { socketGateway } from './socket-gateway.service';

let io: IOServer | null = null;

const ALL_NAMESPACES = [
  SocketNamespace.ROOT,
  SocketNamespace.MATCHES,
  SocketNamespace.LEADERBOARDS,
  SocketNamespace.WALLETS,
  SocketNamespace.NOTIFICATIONS,
  SocketNamespace.ADMIN,
];

const authMiddleware = (socket: Socket, next: (err?: Error) => void): void => {
  try {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return next(new Error('Missing auth token'));
    const claims = verifyAccessToken(token);
    socket.data.userId = claims.sub;
    socket.data.sessionId = claims.sessionId;
    next();
  } catch (err) {
    next(err as Error);
  }
};

const wireNamespace = (nsp: ReturnType<IOServer['of']>): void => {
  nsp.use(authMiddleware);
  nsp.on(SocketEvent.CONNECT, (socket: Socket) => {
    registerRoomHandlers(socket);
    socketGateway.trackConnection();
    logger.info(
      { event: 'socket.connect', ns: nsp.name, userId: socket.data.userId, sid: socket.id },
      'Socket connected',
    );
    socket.on(SocketEvent.DISCONNECT, (reason) => {
      socketGateway.trackConnection();
      logger.info(
        { event: 'socket.disconnect', ns: nsp.name, userId: socket.data.userId, sid: socket.id, reason },
        'Socket disconnected',
      );
    });
  });
};

const attachRedisAdapter = async (server: IOServer): Promise<void> => {
  if (!isRedisEnabled()) return;

  const pubClient = env.REDIS_URL
    ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false })
    : new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        username: env.REDIS_USERNAME || undefined,
        password: env.REDIS_PASSWORD || undefined,
        db: env.REDIS_DB,
        ...(env.REDIS_TLS ? { tls: {} } : {}),
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
  const subClient = pubClient.duplicate();
  server.adapter(createAdapter(pubClient, subClient));
  logger.info({ event: 'socket.adapter.redis' }, 'Socket.io Redis adapter attached');
};

export const initSocketServer = async (httpServer: HttpServer): Promise<IOServer> => {
  if (io) return io;

  io = new IOServer(httpServer, {
    path: env.SOCKET_PATH,
    pingInterval: env.SOCKET_PING_INTERVAL,
    pingTimeout: env.SOCKET_PING_TIMEOUT,
    cors: {
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    },
  });

  await attachRedisAdapter(io);

  ALL_NAMESPACES.forEach((name) => {
    if (name === SocketNamespace.ROOT) {
      io!.use(authMiddleware);
      io!.on(SocketEvent.CONNECT, (socket) => registerRoomHandlers(socket));
    } else {
      wireNamespace(io!.of(name));
    }
  });

  await initRedisSubscriber(async (envelope) => {
    await socketGateway.dispatch(envelope);
  });

  return io;
};

export const getSocketServer = (): IOServer => {
  if (!io) throw new Error('Socket server not initialised');
  return io;
};

export const shutdownSocketServer = async (): Promise<void> => {
  await shutdownRedisSubscriber();
  if (!io) return;
  await new Promise<void>((resolve) => io?.close(() => resolve()));
  io = null;
};

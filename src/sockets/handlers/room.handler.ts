import type { Socket } from 'socket.io';

import { logger } from '@config/logger.config';

import { SocketEvent } from '@common/enums';

import { realtimeMetrics } from '@events/realtime-metrics.service';

import { SocketRoom } from '../room-keys';

const ALLOWED_ROOM_PREFIXES = ['user:', 'contest:', 'match:'] as const;

const isAllowedRoom = (room: string): boolean =>
  ALLOWED_ROOM_PREFIXES.some((prefix) => room.startsWith(prefix));

/**
 * Registers join/leave handlers shared across all namespaces.
 */
export const registerRoomHandlers = (socket: Socket): void => {
  socket.on(SocketEvent.JOIN_ROOM, (room: unknown) => {
    if (typeof room !== 'string' || !isAllowedRoom(room)) {
      logger.warn({ room, sid: socket.id }, 'Rejected socket room join');
      return;
    }
    void socket.join(room);
    realtimeMetrics.trackRoom(room);
    logger.debug({ room, sid: socket.id }, 'Socket joined room');
  });

  socket.on(SocketEvent.LEAVE_ROOM, (room: unknown) => {
    if (typeof room !== 'string' || !isAllowedRoom(room)) return;
    void socket.leave(room);
    realtimeMetrics.untrackRoom(room);
  });

  const userId = socket.data.userId as string | undefined;
  if (userId) {
    void socket.join(SocketRoom.user(userId));
  }
};

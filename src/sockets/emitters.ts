import { RealtimeEvent, SocketEvent } from '@common/enums';

import { socketGateway } from './socket-gateway.service';
import { getSocketServer } from './socket.server';

/**
 * Type-safe emitters used by feature services / queue workers.
 * Prefer `realtimePublisher` for new code — these remain for legacy callers.
 */
export const emitToUser = (userId: string, event: SocketEvent, payload: unknown): void => {
  socketGateway.emitLegacyToUser(userId, event, payload);
};

export const emitToRoom = (room: string, event: RealtimeEvent | SocketEvent, payload: unknown): void => {
  getSocketServer().to(room).emit(event, payload);
};

export const broadcast = (event: SocketEvent, payload: unknown): void => {
  getSocketServer().emit(event, payload);
};

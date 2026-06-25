import type { Namespace, Server as IOServer } from 'socket.io';

import { logger } from '@config/logger.config';

import { RealtimeEvent, SocketEvent, SocketNamespace } from '@common/enums';

import type { RealtimeEnvelope } from '@events/event.contracts';
import { resolveNamespace } from '@events/event.registry';
import { realtimeMetrics } from '@events/realtime-metrics.service';

import { getSocketServer } from './socket.server';

/**
 * Bridges Redis pub/sub envelopes to Socket.io namespaces + rooms.
 * Multi-instance safe when combined with `@socket.io/redis-adapter`.
 */
class SocketGatewayService {
  private getNamespace(ns: SocketNamespace): Namespace {
    const io = getSocketServer();
    return ns === SocketNamespace.ROOT ? io : io.of(ns);
  }

  async dispatch(envelope: RealtimeEnvelope): Promise<void> {
    const namespace = resolveNamespace(envelope.event);
    const nsp = this.getNamespace(namespace);

    try {
      switch (envelope.target.kind) {
        case 'user':
          nsp.to(`user:${envelope.target.userId}`).emit(envelope.event, envelope);
          break;
        case 'room':
          nsp.to(envelope.target.room).emit(envelope.event, envelope);
          break;
        case 'broadcast':
          nsp.emit(envelope.event, envelope);
          break;
        default:
          break;
      }

      if (envelope.event === RealtimeEvent.ADMIN_METRICS) {
        this.getNamespace(SocketNamespace.ADMIN).emit(envelope.event, envelope);
      }
    } catch (err) {
      logger.error({ err, event: envelope.event }, 'Socket gateway dispatch failed');
      throw err;
    }
  }

  emitAdminMetrics(): void {
    const payload = {
      metrics: realtimeMetrics.snapshot(),
      at: new Date().toISOString(),
    };
    this.getNamespace(SocketNamespace.ADMIN).emit(RealtimeEvent.ADMIN_METRICS, payload);
  }

  trackConnection(): void {
    const io = getSocketServer();
    const count = io.engine.clientsCount;
    realtimeMetrics.setSocketConnections(count);
  }

  /** Legacy helper — maps old SocketEvent to RealtimeEvent where applicable. */
  emitLegacyToUser(userId: string, event: SocketEvent, payload: unknown): void {
    const nsp = this.getNamespace(SocketNamespace.ROOT);
    nsp.to(`user:${userId}`).emit(event, payload);
  }
}

export const socketGateway = new SocketGatewayService();

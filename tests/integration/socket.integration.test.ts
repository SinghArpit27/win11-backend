import http from 'node:http';

import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RealtimeEvent, SocketNamespace } from '@common/enums';

import { initRealtimeJobs } from '@jobs/realtime.jobs';
import { realtimePublisher } from '@events/realtime.publisher';
import { initSocketServer, shutdownSocketServer } from '@sockets/socket.server';

import { signupViaApi } from '../helpers/auth.helper';
import { getAgent } from '../helpers/api.client';

describe('Socket.io integration', () => {
  let httpServer: http.Server;
  let port: number;
  let socket: Socket | null = null;

  beforeAll(async () => {
    httpServer = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    await initSocketServer(httpServer);
    await initRealtimeJobs();

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address();
        port = typeof address === 'object' && address ? address.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    socket?.disconnect();
    await shutdownSocketServer();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('delivers wallet events to the authenticated user namespace', async () => {
    const agent = getAgent();
    const user = await signupViaApi(agent);

    const url = `http://127.0.0.1:${port}${SocketNamespace.WALLETS}`;
    socket = ioClient(url, {
      path: process.env.SOCKET_PATH ?? '/socket.io',
      transports: ['websocket'],
      auth: { token: user.tokens.accessToken },
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket connect timeout')), 10_000);
      socket!.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket!.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const received = new Promise<unknown>((resolve) => {
      socket!.on(RealtimeEvent.WALLET_CREDITED, (envelope) => resolve(envelope));
    });

    await realtimePublisher.walletCredited({
      userId: user.userId,
      currency: 'INR',
      spendable: 10_000,
      locked: 0,
      amount: 10_000,
    });

    const envelope = (await received) as { event: string; payload: { spendable: number } };
    expect(envelope.event).toBe(RealtimeEvent.WALLET_CREDITED);
    expect(envelope.payload.spendable).toBe(10_000);
  });

  it('reconnects with the same auth token after disconnect', async () => {
    const agent = getAgent();
    const user = await signupViaApi(agent);
    const url = `http://127.0.0.1:${port}${SocketNamespace.NOTIFICATIONS}`;

    const client = ioClient(url, {
      path: process.env.SOCKET_PATH ?? '/socket.io',
      transports: ['websocket'],
      auth: { token: user.tokens.accessToken },
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), 10_000);
      client.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      client.on('connect_error', reject);
    });

    client.disconnect();
    await new Promise<void>((resolve) => {
      client.on('connect', () => resolve());
      client.connect();
    });

    expect(client.connected).toBe(true);
    client.disconnect();
  });
});

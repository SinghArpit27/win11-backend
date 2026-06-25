import { describe, expect, it } from 'vitest';

import { RealtimeEvent, SocketNamespace } from '@common/enums';

import { buildEnvelope } from '@events/redis-publisher.service';
import { eventNamespaceMap, resolveNamespace } from '@events/event.registry';

describe('Realtime event registry', () => {
  it('maps every RealtimeEvent to a namespace', () => {
    for (const event of Object.values(RealtimeEvent)) {
      expect(eventNamespaceMap[event]).toBeDefined();
      expect(resolveNamespace(event)).toBe(eventNamespaceMap[event]);
    }
  });

  it('routes wallet events to /wallets namespace', () => {
    expect(resolveNamespace(RealtimeEvent.WALLET_CREDITED)).toBe(SocketNamespace.WALLETS);
  });

  it('builds versioned envelopes', () => {
    const envelope = buildEnvelope(
      RealtimeEvent.NOTIFICATION_NEW,
      { kind: 'user', userId: 'user-1' },
      { title: 'Hello' },
      'corr-1',
    );

    expect(envelope.v).toBe(1);
    expect(envelope.event).toBe(RealtimeEvent.NOTIFICATION_NEW);
    expect(envelope.target).toEqual({ kind: 'user', userId: 'user-1' });
    expect(envelope.payload).toEqual({ title: 'Hello' });
    expect(envelope.correlationId).toBe('corr-1');
    expect(envelope.id).toBeTruthy();
    expect(envelope.occurredAt).toBeTruthy();
  });
});

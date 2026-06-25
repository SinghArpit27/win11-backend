import { RealtimeEvent, SocketNamespace } from '@common/enums';

/**
 * Central registry mapping domain events to Socket.io namespaces.
 * Single source of truth — never hardcode namespace strings in features.
 */
export const REALTIME_REDIS_CHANNEL = 'realtime:events';
export const REALTIME_DEAD_LETTER_KEY = 'realtime:dead-letter';

export const eventNamespaceMap: Record<RealtimeEvent, SocketNamespace> = {
  [RealtimeEvent.MATCH_UPDATE]: SocketNamespace.MATCHES,
  [RealtimeEvent.LEADERBOARD_UPDATED]: SocketNamespace.LEADERBOARDS,
  [RealtimeEvent.LEADERBOARD_RANK_CHANGED]: SocketNamespace.LEADERBOARDS,
  [RealtimeEvent.LEADERBOARD_POINTS_CHANGED]: SocketNamespace.LEADERBOARDS,
  [RealtimeEvent.CONTEST_JOINED]: SocketNamespace.LEADERBOARDS,
  [RealtimeEvent.CONTEST_FILLED]: SocketNamespace.LEADERBOARDS,
  [RealtimeEvent.CONTEST_LOCKED]: SocketNamespace.LEADERBOARDS,
  [RealtimeEvent.CONTEST_CANCELLED]: SocketNamespace.LEADERBOARDS,
  [RealtimeEvent.WALLET_UPDATED]: SocketNamespace.WALLETS,
  [RealtimeEvent.WALLET_DEBITED]: SocketNamespace.WALLETS,
  [RealtimeEvent.WALLET_CREDITED]: SocketNamespace.WALLETS,
  [RealtimeEvent.DEPOSIT_COMPLETED]: SocketNamespace.WALLETS,
  [RealtimeEvent.WITHDRAWAL_APPROVED]: SocketNamespace.WALLETS,
  [RealtimeEvent.WITHDRAWAL_REJECTED]: SocketNamespace.WALLETS,
  [RealtimeEvent.KYC_APPROVED]: SocketNamespace.NOTIFICATIONS,
  [RealtimeEvent.KYC_REJECTED]: SocketNamespace.NOTIFICATIONS,
  [RealtimeEvent.NOTIFICATION_NEW]: SocketNamespace.NOTIFICATIONS,
  [RealtimeEvent.NOTIFICATION_READ]: SocketNamespace.NOTIFICATIONS,
  [RealtimeEvent.ADMIN_METRICS]: SocketNamespace.ADMIN,
};

export const resolveNamespace = (event: RealtimeEvent): SocketNamespace =>
  eventNamespaceMap[event] ?? SocketNamespace.ROOT;

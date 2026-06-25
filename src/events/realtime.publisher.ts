import { RealtimeEvent } from '@common/enums';

import { eventBus } from '@events/event-bus.service';
import type {
  ContestFilledPayload,
  ContestJoinedPayload,
  ContestStatusPayload,
  LeaderboardPointsChangedPayload,
  LeaderboardRankChangedPayload,
  LeaderboardUpdatedPayload,
  MatchUpdatePayload,
  NotificationNewPayload,
  WalletEventPayload,
} from '@events/event.contracts';
import { SocketRoom } from '@sockets/room-keys';

/**
 * Thin facade used by feature services — keeps domain code decoupled from
 * BullMQ / Redis / Socket.io wiring.
 */
export const realtimePublisher = {
  leaderboardUpdated(payload: LeaderboardUpdatedPayload): Promise<void> {
    return eventBus.publishBuilt(RealtimeEvent.LEADERBOARD_UPDATED, { kind: 'room', room: SocketRoom.contest(payload.contestId) }, payload);
  },

  leaderboardRankChanged(payload: LeaderboardRankChangedPayload): Promise<void> {
    return eventBus.publishBuilt(
      RealtimeEvent.LEADERBOARD_RANK_CHANGED,
      { kind: 'room', room: SocketRoom.contest(payload.contestId) },
      payload,
    );
  },

  leaderboardPointsChanged(payload: LeaderboardPointsChangedPayload): Promise<void> {
    return eventBus.publishBuilt(
      RealtimeEvent.LEADERBOARD_POINTS_CHANGED,
      { kind: 'room', room: SocketRoom.contest(payload.contestId) },
      payload,
    );
  },

  contestJoined(payload: ContestJoinedPayload): Promise<void> {
    return Promise.all([
      eventBus.publishBuilt(
        RealtimeEvent.CONTEST_JOINED,
        { kind: 'room', room: SocketRoom.contest(payload.contestId) },
        payload,
      ),
      eventBus.publishBuilt(
        RealtimeEvent.CONTEST_JOINED,
        { kind: 'user', userId: payload.userId },
        payload,
      ),
    ]).then(() => undefined);
  },

  contestFilled(payload: ContestFilledPayload): Promise<void> {
    return eventBus.publishBuilt(
      RealtimeEvent.CONTEST_FILLED,
      { kind: 'room', room: SocketRoom.contest(payload.contestId) },
      payload,
    );
  },

  contestLocked(payload: ContestStatusPayload): Promise<void> {
    return eventBus.publishBuilt(
      RealtimeEvent.CONTEST_LOCKED,
      { kind: 'room', room: SocketRoom.contest(payload.contestId) },
      payload,
    );
  },

  contestCancelled(payload: ContestStatusPayload): Promise<void> {
    return eventBus.publishBuilt(
      RealtimeEvent.CONTEST_CANCELLED,
      { kind: 'room', room: SocketRoom.contest(payload.contestId) },
      payload,
    );
  },

  walletUpdated(payload: WalletEventPayload): Promise<void> {
    return eventBus.publishBuilt(
      RealtimeEvent.WALLET_UPDATED,
      { kind: 'user', userId: payload.userId },
      payload,
    );
  },

  walletDebited(payload: WalletEventPayload): Promise<void> {
    return eventBus.publishBuilt(
      RealtimeEvent.WALLET_DEBITED,
      { kind: 'user', userId: payload.userId },
      payload,
    );
  },

  walletCredited(payload: WalletEventPayload): Promise<void> {
    return eventBus.publishBuilt(
      RealtimeEvent.WALLET_CREDITED,
      { kind: 'user', userId: payload.userId },
      payload,
    );
  },

  matchUpdate(payload: MatchUpdatePayload): Promise<void> {
    return eventBus.publishBuilt(
      RealtimeEvent.MATCH_UPDATE,
      { kind: 'room', room: SocketRoom.match(payload.matchId) },
      payload,
    );
  },

  notificationNew(payload: NotificationNewPayload): Promise<void> {
    return eventBus.publishBuilt(
      RealtimeEvent.NOTIFICATION_NEW,
      { kind: 'user', userId: payload.userId },
      payload,
    );
  },

  depositCompleted(payload: WalletEventPayload & { paymentId: string }): Promise<void> {
    return Promise.all([
      eventBus.publishBuilt(RealtimeEvent.DEPOSIT_COMPLETED, { kind: 'user', userId: payload.userId }, payload),
      eventBus.publishBuilt(RealtimeEvent.WALLET_CREDITED, { kind: 'user', userId: payload.userId }, payload),
    ]).then(() => undefined);
  },

  withdrawalApproved(payload: { userId: string; withdrawalId: string; amount: number; currency: string }): Promise<void> {
    return eventBus.publishBuilt(RealtimeEvent.WITHDRAWAL_APPROVED, { kind: 'user', userId: payload.userId }, payload);
  },

  withdrawalRejected(payload: { userId: string; withdrawalId: string; reason: string }): Promise<void> {
    return eventBus.publishBuilt(RealtimeEvent.WITHDRAWAL_REJECTED, { kind: 'user', userId: payload.userId }, payload);
  },

  kycApproved(payload: { userId: string; profileId: string }): Promise<void> {
    return eventBus.publishBuilt(RealtimeEvent.KYC_APPROVED, { kind: 'user', userId: payload.userId }, payload);
  },

  kycRejected(payload: { userId: string; profileId: string; reason: string }): Promise<void> {
    return eventBus.publishBuilt(RealtimeEvent.KYC_REJECTED, { kind: 'user', userId: payload.userId }, payload);
  },
};

import type { NotificationType, RealtimeEvent } from '@common/enums';

/** Target routing for a realtime envelope. */
export type RealtimeTarget =
  | { kind: 'user'; userId: string }
  | { kind: 'room'; room: string }
  | { kind: 'broadcast' };

/** Versioned wire envelope published through BullMQ → Redis → Socket.io. */
export interface RealtimeEnvelope<TPayload = Record<string, unknown>> {
  v: 1;
  id: string;
  event: RealtimeEvent;
  target: RealtimeTarget;
  payload: TPayload;
  occurredAt: string;
  correlationId?: string;
}

export interface LeaderboardUpdatedPayload {
  contestId: string;
  matchId: string;
  totalEntries: number;
  topScore: number;
}

export interface LeaderboardRankChangedPayload {
  contestId: string;
  entryId: string;
  userId: string;
  rank: number;
  previousRank: number | null;
  points: number;
}

export interface LeaderboardPointsChangedPayload {
  contestId: string;
  entryId: string;
  userId: string;
  points: number;
  delta: number;
}

export interface ContestJoinedPayload {
  contestId: string;
  matchId: string;
  userId: string;
  entryId: string;
  filledSpots: number;
  totalSpots: number;
}

export interface ContestFilledPayload {
  contestId: string;
  matchId: string;
  filledSpots: number;
  totalSpots: number;
}

export interface ContestStatusPayload {
  contestId: string;
  matchId: string;
  status: string;
}

export interface WalletEventPayload {
  userId: string;
  currency: string;
  spendable: number;
  locked: number;
  amount?: number;
  referenceType?: string | null;
  referenceId?: string | null;
}

export interface NotificationNewPayload {
  notificationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface MatchUpdatePayload {
  matchId: string;
  status: string;
  snapshot?: Record<string, unknown>;
}

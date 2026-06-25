export { eventBus } from './event-bus.service';
export { redisPublisher, buildEnvelope } from './redis-publisher.service';
export { initRedisSubscriber, shutdownRedisSubscriber } from './redis-subscriber.service';
export { deadLetterService } from './dead-letter.service';
export { realtimeMetrics } from './realtime-metrics.service';
export {
  REALTIME_REDIS_CHANNEL,
  REALTIME_DEAD_LETTER_KEY,
  eventNamespaceMap,
  resolveNamespace,
} from './event.registry';
export type {
  RealtimeEnvelope,
  RealtimeTarget,
  LeaderboardUpdatedPayload,
  LeaderboardRankChangedPayload,
  LeaderboardPointsChangedPayload,
  ContestJoinedPayload,
  ContestFilledPayload,
  ContestStatusPayload,
  WalletEventPayload,
  NotificationNewPayload,
  MatchUpdatePayload,
} from './event.contracts';

export { LeaderboardSnapshot } from './leaderboard-snapshot.model';
export type {
  ILeaderboardSnapshot,
  ILeaderboardTopEntry,
  LeaderboardSnapshotDoc,
} from './leaderboard-snapshot.model';

export { RankHistory } from './rank-history.model';
export type { IRankHistory, RankHistoryDoc } from './rank-history.model';

export { ContestResult } from './contest-result.model';
export type {
  ContestResultDoc,
  IContestResult,
  IContestResultWinner,
} from './contest-result.model';

export {
  leaderboardSnapshotRepository,
  LeaderboardSnapshotRepository,
} from './leaderboard-snapshot.repository';
export { rankHistoryRepository, RankHistoryRepository } from './rank-history.repository';
export {
  contestResultRepository,
  ContestResultRepository,
} from './contest-result.repository';

export { leaderboardRedis, LeaderboardRedis, toRedisScore, fromRedisScore } from './leaderboard-redis';
export type { LeaderboardZsetEntry } from './leaderboard-redis';

export { leaderboardService, LeaderboardService } from './leaderboard.service';

export {
  leaderboardSnapshotSerializer,
  rankHistorySerializer,
  contestResultSerializer,
} from './leaderboard.serializers';

export type {
  LeaderboardPageDTO,
  LeaderboardRowDTO,
  LeaderboardSnapshotDTO,
  RankHistoryDTO,
  RankHistoryPointDTO,
  RebuildLeaderboardInput,
  RebuildLeaderboardResult,
  UserRankDTO,
} from './leaderboard.types';

export { leaderboardRoutes } from './leaderboard.routes';

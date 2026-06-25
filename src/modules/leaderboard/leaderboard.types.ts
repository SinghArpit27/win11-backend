import type {
  LeaderboardScope,
  LeaderboardSnapshotReason,
  RankMovement,
} from '@common/enums';

/**
 * Backend DTO shapes for the leaderboard module.
 *
 * The wire shape is reused by the FE — the frontend `leaderboard.types`
 * re-declares a structurally identical interface so the two sides
 * never drift.
 */

export interface LeaderboardRowDTO {
  rank: number;
  /** ContestEntry (CONTEST) or FantasyTeam (MATCH) id. */
  entryId: string;
  userId: string;
  teamId: string;
  displayName: string;
  avatarUrl: string | null;
  points: number;
  /** Movement vs the previous snapshot — UI uses for arrow chips. */
  movement: RankMovement;
  rankDelta: number;
  pointsDelta: number;
  /** Estimated winnings for this rank — null if contest hasn't been settled
   *  and prize snapshot does not award this rank. */
  projectedWinning: number | null;
  /** True if this row is the requesting user's entry. */
  isCurrentUser: boolean;
  /** Hint for the UI badge: "C", "VC", "WK", etc — flexible. */
  badge: string | null;
}

export interface LeaderboardPageDTO {
  scope: LeaderboardScope;
  scopeId: string;
  page: number;
  pageSize: number;
  totalEntries: number;
  topScore: number;
  /** Whether the leaderboard is live (match in progress) or final. */
  isFinal: boolean;
  currency: string | null;
  /** Sliced entries for the current page. */
  rows: LeaderboardRowDTO[];
}

export interface UserRankDTO {
  scope: LeaderboardScope;
  scopeId: string;
  entryId: string;
  userId: string;
  rank: number | null;
  points: number;
  totalEntries: number;
  movement: RankMovement;
  rankDelta: number;
  pointsDelta: number;
  projectedWinning: number | null;
}

export interface RankHistoryPointDTO {
  rank: number;
  points: number;
  movement: RankMovement;
  rankDelta: number;
  pointsDelta: number;
  capturedAt: string;
}

export interface RankHistoryDTO {
  scope: LeaderboardScope;
  scopeId: string;
  entryId: string;
  userId: string;
  points: number[];
  history: RankHistoryPointDTO[];
}

export interface LeaderboardSnapshotDTO {
  id: string;
  scope: LeaderboardScope;
  scopeId: string;
  matchId: string;
  reason: LeaderboardSnapshotReason;
  totalEntries: number;
  topScore: number;
  topEntries: Array<{
    rank: number;
    entryId: string;
    userId: string;
    teamId: string;
    displayName: string;
    points: number;
  }>;
  capturedAt: string;
}

export interface RebuildLeaderboardInput {
  contestId: string;
  reason: LeaderboardSnapshotReason;
  scoreEventId?: string | null;
  triggeredBy?: string | null;
}

export interface RebuildLeaderboardResult {
  contestId: string;
  totalEntries: number;
  topScore: number;
  snapshotId: string | null;
  historyRowsWritten: number;
}

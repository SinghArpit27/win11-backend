import type { ContestResultDoc } from './contest-result.model';
import type { LeaderboardSnapshotDoc } from './leaderboard-snapshot.model';
import type { RankHistoryDoc } from './rank-history.model';
import type { LeaderboardSnapshotDTO } from './leaderboard.types';

export const leaderboardSnapshotSerializer = {
  toDTO(doc: LeaderboardSnapshotDoc): LeaderboardSnapshotDTO {
    return {
      id: String(doc._id),
      scope: doc.scope,
      scopeId: String(doc.scopeId),
      matchId: String(doc.matchId),
      reason: doc.reason,
      totalEntries: doc.totalEntries,
      topScore: doc.topScore,
      topEntries: doc.topEntries.map((t) => ({
        rank: t.rank,
        entryId: String(t.entryId),
        userId: String(t.userId),
        teamId: String(t.teamId),
        displayName: t.displayName,
        points: t.points,
      })),
      capturedAt: doc.capturedAt.toISOString(),
    };
  },
};

export const rankHistorySerializer = {
  toDTO(doc: RankHistoryDoc) {
    return {
      id: String(doc._id),
      scope: doc.scope,
      scopeId: String(doc.scopeId),
      entryId: String(doc.entryId),
      userId: String(doc.userId),
      matchId: String(doc.matchId),
      rank: doc.rank,
      points: doc.points,
      previousRank: doc.previousRank,
      previousPoints: doc.previousPoints,
      movement: doc.movement,
      rankDelta: doc.rankDelta,
      pointsDelta: doc.pointsDelta,
      capturedAt: doc.capturedAt.toISOString(),
    };
  },
};

export const contestResultSerializer = {
  toDTO(doc: ContestResultDoc) {
    return {
      id: String(doc._id),
      contestId: String(doc.contestId),
      matchId: String(doc.matchId),
      status: doc.status,
      errorMessage: doc.errorMessage,
      poolAmount: doc.poolAmount,
      totalPaidOut: doc.totalPaidOut,
      commissionAmount: doc.commissionAmount,
      currency: doc.currency,
      totalEntries: doc.totalEntries,
      totalWinners: doc.totalWinners,
      topScore: doc.topScore,
      uniqueWinningScores: doc.uniqueWinningScores,
      topEntries: doc.topEntries.map((t) => ({
        rank: t.rank,
        entryId: String(t.entryId),
        userId: String(t.userId),
        teamId: String(t.teamId),
        points: t.points,
        winningAmount: t.winningAmount,
        isTied: t.isTied,
      })),
      startedAt: doc.startedAt ? doc.startedAt.toISOString() : null,
      completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
      durationMs: doc.durationMs,
    };
  },
};

import type { FantasyPointsDoc } from './fantasy-points.model';
import type { ScoreEventDoc } from './score-event.model';
import type { FantasyPointsDTO, ScoreEventDTO } from './scoring.types';

export const fantasyPointsSerializer = {
  toDTO(doc: FantasyPointsDoc): FantasyPointsDTO {
    return {
      id: String(doc._id),
      matchId: String(doc.matchId),
      playerId: String(doc.playerId),
      teamId: doc.teamId ? String(doc.teamId) : null,
      role: doc.role,
      basePoints: doc.basePoints,
      breakdown: { ...doc.breakdown },
      events: doc.events.map((e) => ({
        code: e.code,
        category: e.category,
        label: e.label,
        rawValue: e.rawValue,
        points: e.points,
      })),
      scoringRuleId: doc.scoringRuleId ? String(doc.scoringRuleId) : null,
      scoringRuleVersion: doc.scoringRuleVersion,
      isPlayed: doc.isPlayed,
      isPlayerOfMatch: doc.isPlayerOfMatch,
      computedAt: doc.computedAt.toISOString(),
    };
  },
};

export const scoreEventSerializer = {
  toDTO(doc: ScoreEventDoc): ScoreEventDTO {
    return {
      id: String(doc._id),
      matchId: String(doc.matchId),
      playerId: doc.playerId ? String(doc.playerId) : null,
      type: doc.type,
      status: doc.status,
      scoringRuleId: doc.scoringRuleId ? String(doc.scoringRuleId) : null,
      scoringRuleVersion: doc.scoringRuleVersion,
      inputRowsCount: doc.inputRowsCount,
      teamsUpdatedCount: doc.teamsUpdatedCount,
      playersUpdatedCount: doc.playersUpdatedCount,
      startedAt: doc.startedAt.toISOString(),
      finishedAt: doc.finishedAt ? doc.finishedAt.toISOString() : null,
      durationMs: doc.durationMs,
      errorMessage: doc.errorMessage,
      errorCode: doc.errorCode,
      triggeredBy: doc.triggeredBy ? String(doc.triggeredBy) : null,
      createdAt: doc.createdAt.toISOString(),
    };
  },
};

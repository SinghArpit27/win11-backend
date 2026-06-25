import type { Types } from 'mongoose';

import type { FantasyScoringCategory, PlayerRole } from '@common/enums';

/**
 * Shared backend DTOs for the scoring module. The HTTP layer +
 * downstream consumers (leaderboard, settlement) depend on these
 * shapes, not on the raw Mongoose documents.
 */

export interface FantasyPointEventDTO {
  code: string;
  category: FantasyScoringCategory;
  label: string;
  rawValue: number;
  points: number;
}

export interface FantasyPointBreakdownDTO {
  batting: number;
  bowling: number;
  fielding: number;
  bonus: number;
  penalty: number;
}

export interface FantasyPointsDTO {
  id: string;
  matchId: string;
  playerId: string;
  teamId: string | null;
  role: PlayerRole;
  basePoints: number;
  breakdown: FantasyPointBreakdownDTO;
  events: FantasyPointEventDTO[];
  scoringRuleId: string | null;
  scoringRuleVersion: number | null;
  isPlayed: boolean;
  isPlayerOfMatch: boolean;
  computedAt: string;
}

export interface ScoreEventDTO {
  id: string;
  matchId: string;
  playerId: string | null;
  type: string;
  status: string;
  scoringRuleId: string | null;
  scoringRuleVersion: number | null;
  inputRowsCount: number;
  teamsUpdatedCount: number;
  playersUpdatedCount: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  errorCode: string | null;
  triggeredBy: string | null;
  createdAt: string;
}

export interface RecomputeMatchResult {
  matchId: string;
  scoreEventId: string;
  inputRowsCount: number;
  teamsUpdatedCount: number;
  playersUpdatedCount: number;
  durationMs: number;
  scoringRuleVersion: number | null;
}

export interface ScoringRecomputeJobPayload {
  matchId: string;
  reason?: string;
  triggeredBy?: string | null;
  scoreEventType?: string;
}

export interface ManualPointsAdjustmentInput {
  matchId: Types.ObjectId | string;
  playerId: Types.ObjectId | string;
  delta: number;
  reason: string;
  actorId: string;
}

import type {
  FantasyScoringCategory,
  FantasyTeamStatus,
  FantasyValidationIssueCode,
  FantasyValidationSeverity,
  MatchFormat,
  PlayerRole,
  Sport,
} from '@common/enums';

/**
 * Public DTO contracts emitted by the fantasy module. Mirrors the model
 * shape but with stringified ObjectIds + null/optional discipline so
 * the wire format is stable for the React client and the mobile app.
 *
 * Every collection has a DTO; admin DTOs share most fields with user
 * DTOs but expose additional `version` + audit fields.
 */

// ─── Rules ────────────────────────────────────────────────────────────

export interface FantasyRoleConstraintDTO {
  role: PlayerRole;
  min: number;
  max: number;
}

export interface FantasyRuleDTO {
  id: string;
  sport: Sport;
  format: MatchFormat;
  name: string;
  description: string | null;
  isActive: boolean;
  teamSize: number;
  creditBudget: number;
  minPerPlayerCredits: number;
  maxPerPlayerCredits: number;
  minFromSingleTeam: number;
  maxFromSingleTeam: number;
  roleConstraints: FantasyRoleConstraintDTO[];
  captainMultiplier: number;
  viceCaptainMultiplier: number;
  maxTeamsPerUserPerMatch: number;
  warnAtTeamsPerUserPerMatch: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Scoring rules ────────────────────────────────────────────────────

export interface FantasyScoringEventDTO {
  code: string;
  category: FantasyScoringCategory;
  label: string;
  statKey: string;
  points: number;
  threshold: number | null;
  unit: number | null;
  appliesTo: PlayerRole[];
  sortOrder: number;
}

export interface FantasyScoringRuleDTO {
  id: string;
  sport: Sport;
  format: MatchFormat;
  name: string;
  description: string | null;
  isActive: boolean;
  version: number;
  events: FantasyScoringEventDTO[];
  createdAt: string;
  updatedAt: string;
}

// ─── Teams ────────────────────────────────────────────────────────────

export interface FantasyTeamPlayerDTO {
  playerId: string;
  /** Minimal player snapshot for rendering. */
  player: {
    id: string;
    name: string;
    shortName: string | null;
    photoUrl: string | null;
  } | null;
  teamId: string;
  team: {
    id: string;
    name: string;
    shortName: string;
    logoUrl: string | null;
    primaryColor: string | null;
  } | null;
  role: PlayerRole;
  credits: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  pointsEarned: number;
}

export interface FantasyTeamPointsBreakdownDTO {
  batting: number;
  bowling: number;
  fielding: number;
  bonus: number;
  penalty: number;
}

export interface FantasyTeamDTO {
  id: string;
  userId: string;
  matchId: string;
  sport: Sport;
  format: MatchFormat;
  ruleId: string;
  ruleVersion: number;
  name: string;
  accentColor: string | null;
  status: FantasyTeamStatus;
  lockedAt: string | null;
  players: FantasyTeamPlayerDTO[];
  totalCreditsUsed: number;
  captainPlayerId: string;
  viceCaptainPlayerId: string;
  roleBreakdown: Record<string, number>;
  teamBreakdown: Record<string, number>;
  totalPoints: number;
  pointsBreakdown: FantasyTeamPointsBreakdownDTO;
  pointsLastComputedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FantasyTeamSummaryDTO {
  id: string;
  matchId: string;
  name: string;
  accentColor: string | null;
  status: FantasyTeamStatus;
  totalCreditsUsed: number;
  totalPoints: number;
  playersCount: number;
  captainPlayerId: string;
  viceCaptainPlayerId: string;
  roleBreakdown: Record<string, number>;
  teamBreakdown: Record<string, number>;
  updatedAt: string;
}

// ─── Drafts ───────────────────────────────────────────────────────────

export interface FantasyDraftPlayerDTO {
  playerId: string;
  role: PlayerRole;
  teamId: string | null;
  credits: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
}

export interface FantasyDraftDTO {
  id: string;
  userId: string;
  matchId: string;
  sport: Sport;
  format: MatchFormat;
  clientDraftId: string | null;
  ruleId: string | null;
  ruleVersion: number | null;
  name: string;
  players: FantasyDraftPlayerDTO[];
  totalCreditsUsed: number;
  captainPlayerId: string | null;
  viceCaptainPlayerId: string | null;
  lastEditedAt: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Validation ───────────────────────────────────────────────────────

export interface FantasyValidationIssueDTO {
  code: FantasyValidationIssueCode;
  severity: FantasyValidationSeverity;
  message: string;
  context?: Record<string, string | number | string[] | undefined>;
}

export interface FantasyValidationSummaryDTO {
  playersSelected: number;
  creditsUsed: number;
  creditsRemaining: number;
  roleBreakdown: Record<string, number>;
  teamBreakdown: Record<string, number>;
  hasCaptain: boolean;
  hasViceCaptain: boolean;
}

export interface FantasyValidationResultDTO {
  isValid: boolean;
  issues: FantasyValidationIssueDTO[];
  summary: FantasyValidationSummaryDTO;
}

// ─── Match-level fantasy context ──────────────────────────────────────

export interface FantasyMatchPlayerDTO {
  id: string;
  name: string;
  shortName: string | null;
  photoUrl: string | null;
  role: PlayerRole;
  country: string | null;
  team: {
    id: string;
    name: string;
    shortName: string;
    logoUrl: string | null;
    primaryColor: string | null;
  } | null;
  credits: number;
  /** % of teams that picked this player (computed from projection). */
  selectionPercent: number | null;
  isInLineup: boolean | null;
}

/**
 * Compact match-meta block embedded into the fantasy context. The
 * create-team UI needs scheduledAt/status/scores up-front so it can
 * render a polished header without an extra round trip to the sports
 * service.
 */
export interface FantasyMatchSummaryDTO {
  id: string;
  status: string;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
  venue: { name: string | null; city: string | null; country: string | null } | null;
  tournament: { id: string; name: string; shortName: string } | null;
  homeTeam: {
    id: string;
    name: string;
    shortName: string;
    logoUrl: string | null;
    primaryColor: string | null;
  };
  awayTeam: {
    id: string;
    name: string;
    shortName: string;
    logoUrl: string | null;
    primaryColor: string | null;
  };
  scores: Array<{
    teamId: string;
    score: number;
    /** Secondary metric — wickets in cricket, fouls in football, etc. */
    secondary: number | null;
    /** Overs / quarter / period as a free-form short string. */
    overs: string | null;
  }>;
}

export interface FantasyMatchContextDTO {
  matchId: string;
  sport: Sport;
  format: MatchFormat;
  lineupLockedAt: string | null;
  isLocked: boolean;
  match: FantasyMatchSummaryDTO | null;
  rule: FantasyRuleDTO | null;
  scoringRule: FantasyScoringRuleDTO | null;
  players: FantasyMatchPlayerDTO[];
}

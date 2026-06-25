import type { Types } from 'mongoose';

import type {
  MatchFormat,
  MatchStatus,
  PlayerRole,
  Sport,
  SportsProviderKey,
  TournamentStatus,
} from '@common/enums';

/**
 * Public DTO shapes returned by the sports controllers.
 *
 * These are the SAME shapes consumed by the frontend `wallet.types.ts`-
 * style file — kept here so the API contract is reviewable in one place.
 * They intentionally use plain `string` for IDs (not `ObjectId`) because
 * they cross the network boundary.
 */

export interface SportsTournamentDTO {
  id: string;
  sport: Sport;
  name: string;
  shortName: string;
  season: string | null;
  country: string | null;
  status: TournamentStatus;
  startDate: string | null;
  endDate: string | null;
  logoUrl: string | null;
  accentColor: string | null;
}

export interface SportsTeamDTO {
  id: string;
  sport: Sport;
  name: string;
  shortName: string;
  country: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}

export interface SportsPlayerDTO {
  id: string;
  sport: Sport;
  name: string;
  shortName: string | null;
  role: PlayerRole;
  position: string | null;
  teamId: string | null;
  country: string | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
  jerseyNumber: number | null;
  dateOfBirth: string | null;
  photoUrl: string | null;
  isActive: boolean;
  /** Default fantasy credit value — PHASE 5. */
  baseCredits: number;
}

export interface SportsMatchTeamScoreDTO {
  teamId: string;
  score: number;
  secondary: number | null;
  overs: string | null;
}

export interface SportsMatchVenueDTO {
  name: string | null;
  city: string | null;
  country: string | null;
}

/**
 * Compact "card" representation — used for list / grid views. Includes
 * the inlined team + tournament metadata required to render a card
 * without N+1 lookups.
 */
export interface SportsMatchCardDTO {
  id: string;
  sport: Sport;
  format: MatchFormat;
  status: MatchStatus;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  isFeatured: boolean;
  isLive: boolean;
  tournament: Pick<SportsTournamentDTO, 'id' | 'name' | 'shortName' | 'season' | 'logoUrl' | 'accentColor'>;
  homeTeam: Pick<SportsTeamDTO, 'id' | 'name' | 'shortName' | 'logoUrl' | 'primaryColor'>;
  awayTeam: Pick<SportsTeamDTO, 'id' | 'name' | 'shortName' | 'logoUrl' | 'primaryColor'>;
  scores: SportsMatchTeamScoreDTO[];
  resultSummary: string | null;
  venue: SportsMatchVenueDTO;
  /**
   * Time at which lineups (playing XI) become final. UI uses this to
   * render the "Lineups Out" pill on the match card.
   */
  lineupLockedAt: string | null;
  lastUpdateAt: string | null;
}

/** Full match detail. Extends the card with toss + popularity counters. */
export interface SportsMatchDetailDTO extends SportsMatchCardDTO {
  winnerTeamId: string | null;
  tossWinnerTeamId: string | null;
  tossDecision: 'BAT' | 'BOWL' | null;
  popularityScore: number;
  viewCount: number;
}

export interface SportsMatchUpdateDTO {
  id: string;
  matchId: string;
  type: string;
  sequence: number;
  providerKey: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface SportsPlayerStatsDTO {
  id: string;
  matchId: string;
  playerId: string;
  sport: Sport;
  teamId: string | null;
  isInLineup: boolean;
  isPlayed: boolean;
  isPlayerOfMatch: boolean;
  stats: Record<string, number | string | boolean | null>;
  fantasyPoints: number;
}

/**
 * Result of an ingestion run. Returned by the admin sync controller so
 * operators see what changed without tailing the logs.
 */
export interface SportsSyncReport {
  provider: SportsProviderKey;
  startedAt: string;
  completedAt: string;
  tournamentsUpserted: number;
  teamsUpserted: number;
  playersUpserted: number;
  matchesUpserted: number;
  matchesStatusChanged: number;
  errors: Array<{ scope: string; message: string }>;
}

/**
 * Lightweight reference often used by service-internal code to pass
 * around a match without re-fetching. Not exposed on the wire.
 */
export interface MatchRef {
  id: string | Types.ObjectId;
  sport: Sport;
  status: MatchStatus;
  scheduledAt: Date;
}

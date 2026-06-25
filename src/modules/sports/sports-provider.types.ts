import type {
  MatchFormat,
  MatchStatus,
  PlayerRole,
  Sport,
  SportsProviderKey,
  TournamentStatus,
} from '@common/enums';

/**
 * Pluggable sports-data provider contract.
 *
 * The architecture supports many providers (CricAPI, SportRadar, Roanuz,
 * scraped feeds, an internal mock) behind ONE interface. The ingestion
 * service depends on this contract — not on any concrete provider —
 * which keeps the platform vendor-neutral and lets QA stand up an
 * isolated mock provider in CI.
 *
 *  Provider DTOs are intentionally LOOSE / string-typed where the upstream
 *  vocabulary differs. The `transformers/*.ts` layer is responsible for
 *  mapping these DTOs into our canonical domain enums (see
 *  `*.transformer.ts`).
 *
 *  SOLID
 *  -----
 *  - **Single responsibility:** providers only fetch + return raw data.
 *    They do NOT touch MongoDB, Redis, or business rules.
 *  - **Open/closed:** new providers ship as new files implementing
 *    `ISportsProvider` — no edits to ingestion code.
 *  - **Liskov / Dependency Inversion:** ingestion code targets this
 *    interface exclusively.
 */

export interface ProviderTournamentDTO {
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

export interface ProviderTeamDTO {
  id: string;
  sport: Sport;
  name: string;
  shortName: string;
  country: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}

export interface ProviderPlayerDTO {
  id: string;
  sport: Sport;
  /** Provider's team identifier — `null` for free-agent / unaffiliated. */
  teamProviderId: string | null;
  name: string;
  shortName: string | null;
  role: PlayerRole;
  position: string | null;
  country: string | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
  jerseyNumber: number | null;
  dateOfBirth: string | null;
  photoUrl: string | null;
  isActive: boolean;
}

export interface ProviderMatchDTO {
  id: string;
  sport: Sport;
  format: MatchFormat;
  tournamentProviderId: string;
  homeTeamProviderId: string;
  awayTeamProviderId: string;
  status: MatchStatus;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  venue: { name: string | null; city: string | null; country: string | null };
  scores: Array<{
    teamProviderId: string;
    score: number;
    secondary: number | null;
    overs: string | null;
  }>;
  resultSummary: string | null;
  winnerTeamProviderId: string | null;
  tossWinnerTeamProviderId: string | null;
  tossDecision: 'BAT' | 'BOWL' | null;
}

export interface ProviderLiveUpdateDTO {
  matchProviderId: string;
  eventId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface ProviderHealth {
  ok: boolean;
  latencyMs: number;
  message?: string;
}

/**
 * Optional sync hints provided by ingestion to filter / scope a fetch
 * (e.g. "only this sport", "only matches after this timestamp"). Concrete
 * providers may ignore fields they don't support.
 */
export interface ProviderQuery {
  sport?: Sport;
  /** ISO-8601 lower bound for "updated since" delta sync. */
  since?: string;
  /** Hard cap on rows the provider returns. */
  limit?: number;
}

export interface ISportsProvider {
  readonly key: SportsProviderKey;
  /** Display name surfaced in the admin UI. */
  readonly displayName: string;
  /** Which sports the provider supports. */
  readonly supportedSports: ReadonlyArray<Sport>;

  /** Cheap health check — used for failover decisions. */
  health(): Promise<ProviderHealth>;

  fetchTournaments(query?: ProviderQuery): Promise<ProviderTournamentDTO[]>;
  fetchTeams(query?: ProviderQuery): Promise<ProviderTeamDTO[]>;
  fetchPlayers(query?: ProviderQuery): Promise<ProviderPlayerDTO[]>;
  fetchMatches(query?: ProviderQuery): Promise<ProviderMatchDTO[]>;

  /**
   * Optional. Providers that expose live ticks override this; the
   * ingestion service skips live-score sync for providers that don't.
   */
  fetchLiveUpdates?(query?: ProviderQuery): Promise<ProviderLiveUpdateDTO[]>;
}

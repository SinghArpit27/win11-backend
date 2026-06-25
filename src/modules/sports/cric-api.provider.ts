import { env } from '@config/env.config';
import { logger } from '@config/logger.config';

import {
  MatchFormat,
  MatchStatus,
  PlayerRole,
  Sport,
  SportsProviderKey,
  TournamentStatus,
} from '@common/enums';

import type {
  ISportsProvider,
  ProviderHealth,
  ProviderMatchDTO,
  ProviderPlayerDTO,
  ProviderQuery,
  ProviderTeamDTO,
  ProviderTournamentDTO,
} from './sports-provider.types';

/**
 * Production-grade adapter for **CricketData.org** (also known as
 * `cricapi.com`).
 *
 *  - Free tier: 100 hits / day with a personal API key (no credit card).
 *    Sign up at https://cricketdata.org/signup.aspx and drop the key
 *    into the `CRIC_API_KEY` environment variable.
 *  - Activated by `registerCricApiProviderIfConfigured()` from
 *    `sports-provider.registry.ts` — when the key is missing the
 *    provider is silently skipped and the mock provider takes over so
 *    the platform remains runnable in any environment.
 *
 *  Architectural notes:
 *  - Owns NO state and writes NOTHING to MongoDB / Redis. All
 *    persistence is handled by `sports-ingestion.service.ts` through
 *    the `ISportsProvider` interface — Open/Closed compliance.
 *  - Uses `fetch` with `AbortController` to respect a hard timeout
 *    (`CRIC_API_TIMEOUT_MS`) so a slow upstream cannot wedge the
 *    ingestion cron.
 *  - Maps the upstream's loose string vocabulary into the platform's
 *    canonical enums in dedicated `mapRole` / `mapMatchType` /
 *    `mapTournamentStatus` helpers — the rest of the file stays
 *    free of magic strings.
 */
class CricApiProvider implements ISportsProvider {
  public readonly key = SportsProviderKey.CRIC_API;
  public readonly displayName = 'CricketData.org';
  public readonly supportedSports: ReadonlyArray<Sport> = [Sport.CRICKET];

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = env.CRIC_API_BASE_URL,
    private readonly timeoutMs: number = env.CRIC_API_TIMEOUT_MS,
  ) {}

  // ── Health ───────────────────────────────────────────────────────────
  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      // `currentMatches` is a low-cost ping endpoint — 1 hit per call.
      await this.get<{ data: unknown[] }>('/currentMatches', { offset: 0 });
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : 'health check failed',
      };
    }
  }

  // ── Tournaments / Series ─────────────────────────────────────────────
  async fetchTournaments(query?: ProviderQuery): Promise<ProviderTournamentDTO[]> {
    if (query?.sport && query.sport !== Sport.CRICKET) return [];
    try {
      const raw = await this.get<{ data: CricApiSeries[] }>('/series', { offset: 0 });
      const mapped = (raw.data ?? []).map((s) => this.mapSeries(s));
      if (mapped.length) return mapped;
    } catch (err) {
      logger.warn(
        { err, event: 'cricapi.series_fallback' },
        'CricAPI /series failed — deriving tournaments from current matches',
      );
    }
    return this.tournamentsFromCurrentMatches();
  }

  // ── Teams ────────────────────────────────────────────────────────────
  async fetchTeams(query?: ProviderQuery): Promise<ProviderTeamDTO[]> {
    if (query?.sport && query.sport !== Sport.CRICKET) return [];
    const seen = new Map<string, ProviderTeamDTO>();

    for (const squad of await this.collectSquads()) {
      const teams = Array.isArray(squad?.teams) ? squad.teams : [];
      for (const team of teams) {
        if (!team?.id || seen.has(team.id)) continue;
        seen.set(team.id, this.mapTeam(team));
      }
    }

    if (seen.size === 0) {
      for (const team of await this.teamsFromCurrentMatches()) {
        seen.set(team.id, team);
      }
    }

    return Array.from(seen.values());
  }

  // ── Players ──────────────────────────────────────────────────────────
  async fetchPlayers(query?: ProviderQuery): Promise<ProviderPlayerDTO[]> {
    if (query?.sport && query.sport !== Sport.CRICKET) return [];
    const seen = new Map<string, ProviderPlayerDTO>();
    for (const squad of await this.collectSquads()) {
      const teams = Array.isArray(squad?.teams) ? squad.teams : [];
      for (const team of teams) {
        for (const player of team.players ?? []) {
          if (!player?.id || seen.has(player.id)) continue;
          seen.set(player.id, this.mapPlayer(player, team.id));
        }
      }
    }
    return Array.from(seen.values());
  }

  // ── Matches ──────────────────────────────────────────────────────────
  async fetchMatches(query?: ProviderQuery): Promise<ProviderMatchDTO[]> {
    if (query?.sport && query.sport !== Sport.CRICKET) return [];

    // `/currentMatches` has live/recent scores; `/matches` adds the upcoming
    // schedule. Merge + de-dupe so home feeds stay populated on free tier.
    const [current, schedule] = await Promise.all([
      this.get<{ data: CricApiMatch[] }>('/currentMatches', { offset: 0 }).catch(
        () => ({ data: [] as CricApiMatch[] }),
      ),
      this.get<{ data: CricApiMatch[] }>('/matches', { offset: 0 }).catch(
        () => ({ data: [] as CricApiMatch[] }),
      ),
    ]);

    const seen = new Map<string, ProviderMatchDTO>();
    for (const raw of [...(current.data ?? []), ...(schedule.data ?? [])]) {
      const dto = this.mapMatch(raw);
      if (dto) seen.set(dto.id, dto);
    }

    let matches = Array.from(seen.values());
    if (query?.limit) matches = matches.slice(0, query.limit);
    return matches;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Fetches squads for every series configured in `CRIC_API_SERIES_IDS`
   * (comma-separated). When the env var is empty we discover series IDs
   * from the current matches feed — that keeps the free 100/day quota
   * lean while still surfacing live tournaments.
   */
  private async collectSquads(): Promise<CricApiSeriesSquad[]> {
    const configured = env.CRIC_API_SERIES_IDS
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    let seriesIds = configured;
    if (seriesIds.length === 0) {
      const current = await this.get<{ data: CricApiMatch[] }>('/currentMatches', {
        offset: 0,
      }).catch(() => ({ data: [] as CricApiMatch[] }));
      const fromCurrent = new Set<string>();
      for (const m of current.data ?? []) {
        if (m.series_id) fromCurrent.add(m.series_id);
      }
      seriesIds = Array.from(fromCurrent);
    }

    // Cap fan-out to avoid blowing the free quota.
    seriesIds = seriesIds.slice(0, 5);

    const results = await Promise.allSettled(
      seriesIds.map((id) =>
        this.get<{ data: CricApiSeriesSquad }>('/series_squad', { id }),
      ),
    );
    return results.flatMap((r) => {
      if (r.status !== 'fulfilled') return [];
      const payload = r.value.data ?? (r.value as unknown as CricApiSeriesSquad);
      if (!payload || !Array.isArray(payload.teams)) return [];
      return [payload];
    });
  }

  /** Derive team rows from `/currentMatches` when squad endpoints fail or return empty. */
  private async teamsFromCurrentMatches(): Promise<ProviderTeamDTO[]> {
    const raw = await this.get<{ data: CricApiMatch[] }>('/currentMatches', { offset: 0 });
    const seen = new Map<string, ProviderTeamDTO>();
    for (const match of raw.data ?? []) {
      for (const info of match.teamInfo ?? []) {
        const id = this.teamProviderId(info);
        if (seen.has(id)) continue;
        seen.set(id, {
          id,
          sport: Sport.CRICKET,
          name: info.name,
          shortName: info.shortname?.toUpperCase() ?? shortenName(info.name, 3).toUpperCase(),
          country: null,
          logoUrl: info.img ?? null,
          primaryColor: null,
          secondaryColor: null,
        });
      }
    }
    return Array.from(seen.values());
  }

  /** Derive tournament rows from `/currentMatches` series metadata. */
  private async tournamentsFromCurrentMatches(): Promise<ProviderTournamentDTO[]> {
    const raw = await this.get<{ data: CricApiMatch[] }>('/currentMatches', { offset: 0 });
    const seen = new Map<string, ProviderTournamentDTO>();
    for (const match of raw.data ?? []) {
      if (!match.series_id) continue;
      if (seen.has(match.series_id)) continue;
      seen.set(match.series_id, {
        id: match.series_id,
        sport: Sport.CRICKET,
        name: match.name?.split(',')?.[0]?.trim() ?? `Series ${match.series_id}`,
        shortName: shortenName(match.name ?? match.series_id, 12),
        season: extractSeason(match.name ?? '') ?? null,
        country: null,
        status: TournamentStatus.ONGOING,
        startDate: toIso(match.dateTimeGMT ?? match.date),
        endDate: null,
        logoUrl: null,
        accentColor: null,
      });
    }
    return Array.from(seen.values());
  }

  /**
   * Performs a GET against the cricapi base URL with a hard timeout and
   * structured error handling. cricapi returns
   *   { status: 'success' | 'failure', data, reason? }
   * we unwrap that envelope so callers always get the inner payload or
   * throw.
   */
  private async get<T>(path: string, params: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}${path}`);
    url.searchParams.set('apikey', this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`cricapi ${path} → HTTP ${res.status}`);
      }
      const json = (await res.json()) as CricApiEnvelope<T>;
      if (json.status === 'failure') {
        throw new Error(`cricapi ${path} → ${json.reason ?? 'failure'}`);
      }
      return json as unknown as T;
    } catch (err) {
      // Surface a helpful upstream error in logs but keep the message
      // generic to the caller — ingestion routes the failure into its
      // own error reporter.
      logger.warn(
        { event: 'cricapi.request_failed', path, error: (err as Error).message },
        'CricAPI request failed',
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Mapping helpers — keep magic strings out of the call sites ──────

  private mapSeries(s: CricApiSeries): ProviderTournamentDTO {
    const status = this.mapTournamentStatus(s.startDate, s.endDate);
    return {
      id: s.id,
      sport: Sport.CRICKET,
      name: s.name,
      shortName: shortenName(s.name, 12),
      season: extractSeason(s.name) ?? null,
      country: null,
      status,
      startDate: toIso(s.startDate),
      endDate: toIso(s.endDate),
      logoUrl: null,
      accentColor: null,
    };
  }

  private mapTeam(t: CricApiSquadTeam): ProviderTeamDTO {
    return {
      id: t.id,
      sport: Sport.CRICKET,
      name: t.name,
      shortName: t.shortname?.toUpperCase() ?? shortenName(t.name, 3).toUpperCase(),
      country: null,
      logoUrl: t.img ?? null,
      primaryColor: null,
      secondaryColor: null,
    };
  }

  private mapPlayer(p: CricApiSquadPlayer, teamId: string): ProviderPlayerDTO {
    return {
      id: p.id,
      sport: Sport.CRICKET,
      teamProviderId: teamId,
      name: p.name,
      shortName: shortenPlayerName(p.name),
      role: mapRole(p.role),
      position: p.role ?? null,
      country: p.country ?? null,
      battingStyle: p.battingStyle ?? null,
      bowlingStyle: p.bowlingStyle ?? null,
      jerseyNumber: null,
      dateOfBirth: toIso(p.dateOfBirth),
      photoUrl: p.playerImg ?? null,
      isActive: true,
    };
  }

  private mapMatch(m: CricApiMatch): ProviderMatchDTO | null {
    if (!m.id || !m.teams || m.teams.length < 2 || !m.series_id) return null;
    const [homeName, awayName] = m.teams;
    if (!homeName || !awayName) return null;
    const homeInfo = (m.teamInfo ?? []).find((t) => t.name === homeName);
    const awayInfo = (m.teamInfo ?? []).find((t) => t.name === awayName);
    if (!homeInfo || !awayInfo) return null;

    const homeTeamProviderId = this.teamProviderId(homeInfo);
    const awayTeamProviderId = this.teamProviderId(awayInfo);

    const status = this.mapMatchStatus(m.matchStarted, m.matchEnded);
    return {
      id: m.id,
      sport: Sport.CRICKET,
      format: mapFormat(m.matchType),
      tournamentProviderId: m.series_id,
      homeTeamProviderId,
      awayTeamProviderId,
      status,
      scheduledAt: toIso(m.dateTimeGMT ?? m.date) ?? new Date().toISOString(),
      startedAt: m.matchStarted ? toIso(m.dateTimeGMT ?? m.date) : null,
      completedAt:
        status === MatchStatus.COMPLETED ? toIso(m.dateTimeGMT ?? m.date) : null,
      venue: {
        name: m.venue ?? null,
        city: null,
        country: null,
      },
      scores: (m.score ?? []).flatMap((s) => {
        const owner = (m.teamInfo ?? []).find((t) =>
          s.inning?.toLowerCase().startsWith(t.name.toLowerCase()),
        );
        if (!owner) return [];
        return [
          {
            teamProviderId: this.teamProviderId(owner),
            score: s.r ?? 0,
            secondary: s.w ?? null,
            overs: s.o ? String(s.o) : null,
          },
        ];
      }),
      resultSummary: m.status ?? null,
      winnerTeamProviderId: null,
      tossWinnerTeamProviderId: null,
      tossDecision: null,
    };
  }

  private mapMatchStatus(started: boolean | undefined, ended: boolean | undefined): MatchStatus {
    if (ended) return MatchStatus.COMPLETED;
    if (started) return MatchStatus.LIVE;
    return MatchStatus.UPCOMING;
  }

  private mapTournamentStatus(start?: string | null, end?: string | null): TournamentStatus {
    const now = Date.now();
    const startMs = start ? new Date(start).getTime() : null;
    const endMs = end ? new Date(end).getTime() : null;
    if (endMs && endMs < now) return TournamentStatus.COMPLETED;
    if (startMs && startMs > now) return TournamentStatus.UPCOMING;
    return TournamentStatus.ONGOING;
  }

  /** Stable external id when cricapi omits `teamInfo[].id` (common on free tier). */
  private teamProviderId(info: { id?: string; name: string }): string {
    if (info.id) return info.id;
    return `cric-name:${info.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }
}

// ─── Pure mapping utilities (exported for unit tests) ───────────────────

/**
 * Maps cricapi's free-form `role` string into our canonical enum.
 *
 *  Examples seen in the wild:
 *   "Batsman", "Batter", "Top order Batsman", "Opening Batter"
 *   "Bowler", "Bowling Allrounder", "Right-arm fast"
 *   "Allrounder", "All rounder"
 *   "Wicketkeeper", "WK-Batter"
 */
export const mapRole = (raw: string | null | undefined): PlayerRole => {
  const text = (raw ?? '').toLowerCase();
  if (!text) return PlayerRole.BATSMAN;
  if (text.includes('wk') || text.includes('wicket')) return PlayerRole.WICKET_KEEPER;
  if (text.includes('all') || text.includes('round')) return PlayerRole.ALL_ROUNDER;
  if (text.includes('bowl') || text.includes('pace') || text.includes('spin'))
    return PlayerRole.BOWLER;
  if (text.includes('bat')) return PlayerRole.BATSMAN;
  return PlayerRole.BATSMAN;
};

/** Maps cricapi `matchType` string into our canonical `MatchFormat`. */
export const mapFormat = (raw: string | null | undefined): MatchFormat => {
  const t = (raw ?? '').toLowerCase();
  if (t.includes('t10')) return MatchFormat.T10;
  if (t.includes('t20')) return MatchFormat.T20;
  if (t.includes('odi') || t.includes('one day')) return MatchFormat.ODI;
  if (t.includes('test')) return MatchFormat.TEST;
  if (t.includes('hundred')) return MatchFormat.T20;
  return MatchFormat.T20;
};

const shortenName = (name: string, length: number): string => {
  if (name.length <= length) return name;
  return name.slice(0, length).trim();
};

const shortenPlayerName = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!;
  const surname = parts[parts.length - 1]!;
  return `${parts[0]![0]} ${surname}`;
};

const extractSeason = (text: string): string | null => {
  const match = text.match(/(20\d{2})(?:[-/](\d{2,4}))?/);
  return match?.[0] ?? null;
};

const toIso = (raw?: string | null): string | null => {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

// ─── Wire types ────────────────────────────────────────────────────────
// These mirror only the fields we actually consume — keeps coupling to
// upstream changes minimal.

interface CricApiEnvelope<T> {
  status: 'success' | 'failure';
  reason?: string;
  data: T extends { data: infer _D } ? _D : T;
}

interface CricApiSeries {
  id: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
}

interface CricApiSquadTeam {
  id: string;
  name: string;
  shortname?: string;
  img?: string;
  players?: CricApiSquadPlayer[];
}

interface CricApiSeriesSquad {
  info: { id: string; name: string };
  teams: CricApiSquadTeam[];
}

interface CricApiSquadPlayer {
  id: string;
  name: string;
  role?: string;
  battingStyle?: string;
  bowlingStyle?: string;
  country?: string;
  playerImg?: string;
  dateOfBirth?: string;
}

interface CricApiMatch {
  id: string;
  name: string;
  series_id: string;
  matchType?: string;
  status?: string;
  venue?: string;
  date?: string;
  dateTimeGMT?: string;
  teams: string[];
  teamInfo?: Array<{ id: string; name: string; shortname?: string; img?: string }>;
  score?: Array<{ inning: string; r?: number; w?: number; o?: number }>;
  matchStarted?: boolean;
  matchEnded?: boolean;
}

// ─── Factory + registry hook ────────────────────────────────────────────

/**
 * Lazy factory — only instantiated when `CRIC_API_KEY` is set. Keeps the
 * default boot path free of any external dependencies / network calls.
 */
export const createCricApiProvider = (): CricApiProvider | null => {
  if (!env.CRIC_API_KEY) return null;
  return new CricApiProvider(env.CRIC_API_KEY);
};

export { CricApiProvider };

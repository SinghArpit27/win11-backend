import { FantasyScoringCategory, type PlayerRole } from '@common/enums';

import type { IFantasyRule } from './fantasy-rule.model';
import type { IFantasyScoringRule, IScoringEvent } from './fantasy-scoring-rule.model';

/**
 * Pure fantasy scoring engine.
 *
 * Phase 5 ships the engine + admin rule management. Live recomputation
 * driven by match events is wired in Phase 7 — but having the pure
 * computation here means leaderboard / scoring infrastructure can
 * unit-test against deterministic fixtures from day one.
 *
 * Inputs
 *  - `scoringRule`  : the active `FantasyScoringRule` snapshot for the
 *                      match's sport+format.
 *  - `teamRule`     : the `FantasyRule` (gives us C/VC multipliers).
 *  - `playerStats`  : raw `Record<statKey, number>` from `player_stats`.
 *  - `role`         : the player's role at team-save time.
 *  - `isCaptain` / `isViceCaptain` : flags from the user's team.
 *
 * Output
 *  - `total` after applying the C/VC multiplier (this is what we add to
 *    `FantasyTeam.totalPoints`),
 *  - `base` (pre-multiplier) so admins / users can see the underlying
 *    points,
 *  - `breakdown` by category for the per-player point chip in the UI.
 *
 * The engine is sport-agnostic and stat-key-agnostic. Adding a new
 * sport / new event = inserting a row into `fantasy_scoring_rules` —
 * no code change required.
 */

export interface FantasyScoringInput {
  scoringRule: IFantasyScoringRule;
  teamRule: Pick<IFantasyRule, 'captainMultiplier' | 'viceCaptainMultiplier'>;
  /**
   * Free-form stat map. Keys must match `IScoringEvent.statKey`. Missing
   * keys are treated as zero. Extra keys are silently ignored.
   */
  playerStats: Record<string, number>;
  role: PlayerRole;
  isCaptain: boolean;
  isViceCaptain: boolean;
}

export interface FantasyScoringBreakdown {
  batting: number;
  bowling: number;
  fielding: number;
  bonus: number;
  penalty: number;
}

export interface FantasyScoringEventApplied {
  code: string;
  label: string;
  category: FantasyScoringCategory;
  /** Raw value pulled from `playerStats[statKey]`. */
  rawValue: number;
  /** Points contributed by this single event (pre-multiplier). */
  pointsContributed: number;
}

export interface FantasyScoringOutput {
  /** Pre-multiplier total. */
  base: number;
  /** Multiplier applied (1, captain, or vice-captain). */
  multiplier: number;
  /** `base * multiplier`. */
  total: number;
  breakdown: FantasyScoringBreakdown;
  /** Per-event audit trail — useful for admin tooltips + unit tests. */
  appliedEvents: FantasyScoringEventApplied[];
}

const ZERO_BREAKDOWN: FantasyScoringBreakdown = {
  batting: 0,
  bowling: 0,
  fielding: 0,
  bonus: 0,
  penalty: 0,
};

/** Map enum → key on `FantasyScoringBreakdown`. */
const breakdownKeyForCategory = (
  category: FantasyScoringCategory,
): keyof FantasyScoringBreakdown => {
  switch (category) {
    case FantasyScoringCategory.BATTING:
      return 'batting';
    case FantasyScoringCategory.BOWLING:
      return 'bowling';
    case FantasyScoringCategory.FIELDING:
      return 'fielding';
    case FantasyScoringCategory.BONUS:
      return 'bonus';
    case FantasyScoringCategory.PENALTY:
      return 'penalty';
    default:
      return 'bonus';
  }
};

/**
 * Computes the contribution of a single scoring event row given the
 * stat map.
 *
 * Three modes per event:
 *  - `threshold` set  → one-shot bonus when `stats[statKey] >= threshold`,
 *  - `unit` set       → scales by `floor(value / unit) * points`,
 *  - otherwise        → linear `value * points`.
 */
const applyEvent = (event: IScoringEvent, stats: Record<string, number>): number => {
  const raw = Number(stats[event.statKey] ?? 0);
  if (!Number.isFinite(raw) || raw === 0) {
    if (event.threshold === null) return 0;
    if (raw === 0) return 0;
  }

  if (event.threshold !== null) {
    return raw >= event.threshold ? event.points : 0;
  }
  if (event.unit !== null && event.unit > 0) {
    return Math.floor(raw / event.unit) * event.points;
  }
  return raw * event.points;
};

const roleAllowed = (event: IScoringEvent, role: PlayerRole): boolean => {
  if (!event.appliesTo || event.appliesTo.length === 0) return true;
  return event.appliesTo.includes(role);
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Compute fantasy points for a single player. `playerStats` is allowed
 * to be empty — the engine returns zeros gracefully.
 */
export const computePlayerPoints = (input: FantasyScoringInput): FantasyScoringOutput => {
  const breakdown: FantasyScoringBreakdown = { ...ZERO_BREAKDOWN };
  const applied: FantasyScoringEventApplied[] = [];
  let base = 0;

  for (const event of input.scoringRule.events) {
    if (!roleAllowed(event, input.role)) continue;
    const contribution = applyEvent(event, input.playerStats);
    if (contribution === 0) continue;
    const key = breakdownKeyForCategory(event.category);
    breakdown[key] = round2(breakdown[key] + contribution);
    base = round2(base + contribution);
    applied.push({
      code: event.code,
      label: event.label,
      category: event.category,
      rawValue: Number(input.playerStats[event.statKey] ?? 0),
      pointsContributed: contribution,
    });
  }

  const multiplier = input.isCaptain
    ? input.teamRule.captainMultiplier
    : input.isViceCaptain
      ? input.teamRule.viceCaptainMultiplier
      : 1;

  return {
    base: round2(base),
    multiplier,
    total: round2(base * multiplier),
    breakdown,
    appliedEvents: applied,
  };
};

export interface FantasyTeamScoringInput {
  scoringRule: IFantasyScoringRule;
  teamRule: Pick<IFantasyRule, 'captainMultiplier' | 'viceCaptainMultiplier'>;
  /** One entry per team player. */
  players: Array<{
    playerId: string;
    role: PlayerRole;
    isCaptain: boolean;
    isViceCaptain: boolean;
    stats: Record<string, number>;
  }>;
}

export interface FantasyTeamScoringResult {
  total: number;
  breakdown: FantasyScoringBreakdown;
  perPlayer: Array<{
    playerId: string;
    output: FantasyScoringOutput;
  }>;
}

/**
 * Compute fantasy points for an entire team. Sum of per-player totals
 * with per-category breakdown rolled up across the roster.
 *
 * Used by the Phase 7 leaderboard worker. Exposed in Phase 5 so admin
 * tooling can preview scoring against a synthetic stats payload.
 */
export const computeTeamPoints = (input: FantasyTeamScoringInput): FantasyTeamScoringResult => {
  const result: FantasyTeamScoringResult = {
    total: 0,
    breakdown: { ...ZERO_BREAKDOWN },
    perPlayer: [],
  };
  for (const player of input.players) {
    const output = computePlayerPoints({
      scoringRule: input.scoringRule,
      teamRule: input.teamRule,
      playerStats: player.stats,
      role: player.role,
      isCaptain: player.isCaptain,
      isViceCaptain: player.isViceCaptain,
    });
    result.total = round2(result.total + output.total);
    for (const k of Object.keys(result.breakdown) as Array<keyof FantasyScoringBreakdown>) {
      // Captain/VC multiplier flows through the per-category breakdown
      // so the UI shows the *effective* batting/bowling totals.
      result.breakdown[k] = round2(result.breakdown[k] + output.breakdown[k] * output.multiplier);
    }
    result.perPlayer.push({ playerId: player.playerId, output });
  }
  return result;
};

import { PlayerRole, FantasyValidationIssueCode, FantasyValidationSeverity } from '@common/enums';

import type { IFantasyRule } from './fantasy-rule.model';

/**
 * Reusable, pure fantasy validation engine.
 *
 * Why pure?
 *  - The same logic is run server-side (authoritative) AND mirrored on
 *    the client (`useFantasyValidation`) for live UI feedback. A pure
 *    function with zero IO is the only safe way to keep the two halves
 *    in lock-step.
 *  - Trivial to unit-test — pass a payload, assert the issue codes.
 *  - The fantasy team service composes it with IO (DB lookups + match
 *    lock check) so this module stays focused on the math.
 *
 * Conventions
 *  - Every issue carries a stable `FantasyValidationIssueCode`. Clients
 *    map codes → localised copy; backend logs codes.
 *  - Issues with severity = ERROR block save; WARNING is advisory only.
 *  - Validation is *non-fatal* — we collect every issue rather than
 *    short-circuiting, so the UI can render the full list.
 */

export interface FantasyValidationIssue {
  code: FantasyValidationIssueCode;
  severity: FantasyValidationSeverity;
  message: string;
  /** Optional offending playerId / role so the UI can highlight rows. */
  context?: Record<string, string | number | string[] | undefined>;
}

export interface FantasyValidationResult {
  isValid: boolean;
  /** All issues — both errors and warnings. */
  issues: FantasyValidationIssue[];
  /** Convenience aggregates the UI needs frequently. */
  summary: {
    playersSelected: number;
    creditsUsed: number;
    creditsRemaining: number;
    roleBreakdown: Record<string, number>;
    teamBreakdown: Record<string, number>;
    hasCaptain: boolean;
    hasViceCaptain: boolean;
  };
}

export interface FantasyValidatorPlayer {
  playerId: string;
  role: PlayerRole;
  /** Real-world team id the player belongs to. */
  teamId: string;
  credits: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
}

export interface FantasyValidatorInput {
  rule: IFantasyRule;
  players: FantasyValidatorPlayer[];
  /**
   * Optional flag indicating the match lineup has locked. When `true`,
   * any save attempt yields a `MATCH_LOCKED` error regardless of the
   * other rule checks.
   */
  matchLocked?: boolean;
  /**
   * Optional saved-team count for the user+match — used to enforce
   * `maxTeamsPerUserPerMatch`. Pass the count *before* the proposed save.
   */
  existingTeamCount?: number;
  /**
   * If this validation is for an UPDATE of an existing team, set this
   * to `true` so `existingTeamCount` is treated correctly (we don't
   * count the team being edited against the cap).
   */
  isEdit?: boolean;
}

const error = (
  code: FantasyValidationIssueCode,
  message: string,
  context?: FantasyValidationIssue['context'],
): FantasyValidationIssue => ({
  code,
  severity: FantasyValidationSeverity.ERROR,
  message,
  context,
});

const warn = (
  code: FantasyValidationIssueCode,
  message: string,
  context?: FantasyValidationIssue['context'],
): FantasyValidationIssue => ({
  code,
  severity: FantasyValidationSeverity.WARNING,
  message,
  context,
});

/** Tally helper — increments `obj[key]` defaulting to 0. */
const inc = (obj: Record<string, number>, key: string): void => {
  obj[key] = (obj[key] ?? 0) + 1;
};

/**
 * Core validator. Caller composes it with IO (existing-team count,
 * match-lock flag) — this function does not perform any DB work.
 */
export const validateFantasyTeam = (input: FantasyValidatorInput): FantasyValidationResult => {
  const { rule, players, matchLocked, existingTeamCount, isEdit } = input;
  const issues: FantasyValidationIssue[] = [];

  // Aggregates ---------------------------------------------------------
  const roleBreakdown: Record<string, number> = {};
  const teamBreakdown: Record<string, number> = {};
  const seenPlayers = new Set<string>();
  let creditsUsed = 0;
  let captainCount = 0;
  let viceCaptainCount = 0;
  let captainPlayerId: string | null = null;
  let viceCaptainPlayerId: string | null = null;

  for (const p of players) {
    if (seenPlayers.has(p.playerId)) {
      issues.push(
        error(FantasyValidationIssueCode.DUPLICATE_PLAYER, `Duplicate player selected`, {
          playerId: p.playerId,
        }),
      );
      continue;
    }
    seenPlayers.add(p.playerId);

    inc(roleBreakdown, p.role);
    inc(teamBreakdown, p.teamId);
    creditsUsed += p.credits;

    if (p.isCaptain) {
      captainCount += 1;
      captainPlayerId = p.playerId;
    }
    if (p.isViceCaptain) {
      viceCaptainCount += 1;
      viceCaptainPlayerId = p.playerId;
    }
  }

  const playersSelected = seenPlayers.size;
  const creditsRemaining = rule.creditBudget - creditsUsed;

  // Match lock — gates everything else if true ------------------------
  if (matchLocked) {
    issues.push(
      error(
        FantasyValidationIssueCode.MATCH_LOCKED,
        'Match has already started — teams can no longer be edited',
      ),
    );
  }

  // Max teams per user per match --------------------------------------
  if (
    typeof existingTeamCount === 'number' &&
    !isEdit &&
    existingTeamCount >= rule.maxTeamsPerUserPerMatch
  ) {
    issues.push(
      error(
        FantasyValidationIssueCode.MAX_TEAMS_PER_USER_REACHED,
        `You already have ${rule.maxTeamsPerUserPerMatch} teams for this match`,
        { current: existingTeamCount, max: rule.maxTeamsPerUserPerMatch },
      ),
    );
  } else if (
    typeof existingTeamCount === 'number' &&
    !isEdit &&
    existingTeamCount + 1 >= rule.warnAtTeamsPerUserPerMatch
  ) {
    issues.push(
      warn(
        FantasyValidationIssueCode.MAX_TEAMS_PER_USER_REACHED,
        `You are nearing the maximum number of teams for this match`,
        { current: existingTeamCount, max: rule.maxTeamsPerUserPerMatch },
      ),
    );
  }

  // Team size ----------------------------------------------------------
  if (playersSelected !== rule.teamSize) {
    issues.push(
      error(
        FantasyValidationIssueCode.TEAM_SIZE_MISMATCH,
        `Team must have exactly ${rule.teamSize} players (current: ${playersSelected})`,
        { expected: rule.teamSize, actual: playersSelected },
      ),
    );
  }

  // Credits ------------------------------------------------------------
  if (creditsUsed > rule.creditBudget) {
    issues.push(
      error(
        FantasyValidationIssueCode.CREDITS_EXCEEDED,
        `Credits exceeded by ${(creditsUsed - rule.creditBudget).toFixed(1)}`,
        { used: creditsUsed, budget: rule.creditBudget },
      ),
    );
  }

  // Role constraints ---------------------------------------------------
  for (const constraint of rule.roleConstraints) {
    const count = roleBreakdown[constraint.role] ?? 0;
    if (count < constraint.min) {
      issues.push(
        error(
          FantasyValidationIssueCode.ROLE_MIN_NOT_MET,
          `Need at least ${constraint.min} ${constraint.role.toLowerCase()}(s) (have ${count})`,
          { role: constraint.role, min: constraint.min, actual: count },
        ),
      );
    }
    if (count > constraint.max) {
      issues.push(
        error(
          FantasyValidationIssueCode.ROLE_MAX_EXCEEDED,
          `Maximum ${constraint.max} ${constraint.role.toLowerCase()}(s) allowed (have ${count})`,
          { role: constraint.role, max: constraint.max, actual: count },
        ),
      );
    }
  }

  // Per-team limits ----------------------------------------------------
  // Validation only runs once enough players exist that we can reason
  // about distribution; otherwise the under-min warning would fire on
  // every single click.
  for (const [teamId, count] of Object.entries(teamBreakdown)) {
    if (count > rule.maxFromSingleTeam) {
      issues.push(
        error(
          FantasyValidationIssueCode.TEAM_PLAYER_LIMIT_EXCEEDED,
          `Maximum ${rule.maxFromSingleTeam} players allowed from a single team (you have ${count})`,
          { teamId, max: rule.maxFromSingleTeam, actual: count },
        ),
      );
    }
  }
  if (playersSelected === rule.teamSize) {
    for (const [teamId, count] of Object.entries(teamBreakdown)) {
      if (count < rule.minFromSingleTeam) {
        issues.push(
          error(
            FantasyValidationIssueCode.TEAM_PLAYER_LIMIT_NOT_MET,
            `Need at least ${rule.minFromSingleTeam} players from each team`,
            { teamId, min: rule.minFromSingleTeam, actual: count },
          ),
        );
      }
    }
  }

  // Captain / Vice-captain --------------------------------------------
  if (captainCount === 0) {
    issues.push(
      error(FantasyValidationIssueCode.CAPTAIN_NOT_SELECTED, 'Please select a captain'),
    );
  } else if (captainCount > 1) {
    issues.push(
      error(
        FantasyValidationIssueCode.CAPTAIN_NOT_SELECTED,
        'A team can have only one captain',
      ),
    );
  }
  if (viceCaptainCount === 0) {
    issues.push(
      error(
        FantasyValidationIssueCode.VICE_CAPTAIN_NOT_SELECTED,
        'Please select a vice-captain',
      ),
    );
  } else if (viceCaptainCount > 1) {
    issues.push(
      error(
        FantasyValidationIssueCode.VICE_CAPTAIN_NOT_SELECTED,
        'A team can have only one vice-captain',
      ),
    );
  }
  if (
    captainPlayerId &&
    viceCaptainPlayerId &&
    captainPlayerId === viceCaptainPlayerId
  ) {
    issues.push(
      error(
        FantasyValidationIssueCode.CAPTAIN_VICE_CAPTAIN_SAME,
        'Captain and vice-captain must be different players',
      ),
    );
  }

  const errors = issues.filter((i) => i.severity === FantasyValidationSeverity.ERROR);

  return {
    isValid: errors.length === 0,
    issues,
    summary: {
      playersSelected,
      creditsUsed: Number(creditsUsed.toFixed(2)),
      creditsRemaining: Number(creditsRemaining.toFixed(2)),
      roleBreakdown,
      teamBreakdown,
      hasCaptain: captainCount === 1,
      hasViceCaptain: viceCaptainCount === 1,
    },
  };
};

/**
 * Convenience helper: build the input from a (rule, snapshot) pair
 * without ceremony. Used by the team controller and the draft service.
 */
export const validateFantasyTeamShape = (
  rule: IFantasyRule,
  players: FantasyValidatorPlayer[],
  opts: { matchLocked?: boolean; existingTeamCount?: number; isEdit?: boolean } = {},
): FantasyValidationResult =>
  validateFantasyTeam({ rule, players, ...opts });

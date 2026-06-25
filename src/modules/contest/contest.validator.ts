import {
  ContestStatus,
  ContestType,
  ContestValidationIssueCode,
  ContestVisibility,
  FantasyTeamStatus,
} from '@common/enums';

import type { IFantasyTeam } from '@modules/fantasy/fantasy-team.model';
import type { IMatch } from '@modules/sports/match.model';

import type { IContest } from './contest.model';

/**
 * Pure-function contest validator.
 *
 *  - **Pure**: takes everything it needs as input, returns issues + an
 *    `ok` flag, performs no IO.
 *  - **Composable**: the join service runs it once before opening a Mongo
 *    transaction and a second time inside the txn with fresher inputs.
 *  - **Sport-agnostic**: works for every supported sport — the contest
 *    object already carries `sport` / `format`.
 *
 * Issue codes are first-class so the FE can map each code to localised
 * copy without parsing English `message` strings.
 */

export interface ContestValidationIssue {
  code: ContestValidationIssueCode;
  message: string;
}

export interface ContestValidationResult {
  ok: boolean;
  issues: ContestValidationIssue[];
}

export interface ValidateJoinInput {
  contest: IContest;
  match: IMatch | null;
  team: IFantasyTeam | null;
  userId: string;
  /** Existing ACTIVE entry count for `(contest, user)`. */
  existingActiveEntries: number;
  /** True ⇒ the same team is already joined to this contest. */
  teamAlreadyJoined: boolean;
  /** Wallet balance in minor units (spendable across all buckets). */
  spendableWalletBalance: number;
  /** Invite code supplied by the client, if any. */
  inviteCode: string | null;
  /** Current wall clock — supplied so tests can pin time. */
  now?: Date;
}

const issue = (
  code: ContestValidationIssueCode,
  message: string,
): ContestValidationIssue => ({ code, message });

const isContestJoinable = (status: ContestStatus): boolean =>
  status === ContestStatus.OPEN || status === ContestStatus.SCHEDULED;

const isMatchPastLock = (match: IMatch | null, now: Date): boolean => {
  if (!match) return false;
  if (match.lineupLockedAt && match.lineupLockedAt.getTime() <= now.getTime()) {
    return true;
  }
  return false;
};

/**
 * Resolves when joining must stop. Match timing is the source of truth
 * when a contest was seeded before the match schedule moved forward —
 * otherwise stale `joinClosesAt` values block every join even though the
 * fixture is still upcoming.
 */
export const resolveJoinClosesAt = (
  contest: IContest,
  match: IMatch | null,
): Date | null => {
  const matchClose = match?.lineupLockedAt ?? match?.scheduledAt ?? null;
  const contestClose = contest.joinClosesAt ?? null;

  if (matchClose && contestClose) {
    // Honour an admin-configured earlier close; otherwise follow the match.
    return matchClose.getTime() > contestClose.getTime() ? matchClose : contestClose;
  }
  return matchClose ?? contestClose;
};

const isWindowOpen = (contest: IContest, match: IMatch | null, now: Date): boolean => {
  if (contest.joinOpensAt && contest.joinOpensAt.getTime() > now.getTime()) return false;
  const closesAt = resolveJoinClosesAt(contest, match);
  if (closesAt && closesAt.getTime() <= now.getTime()) return false;
  return true;
};

/**
 * Validates a user's attempt to join a contest. The order of checks
 * is chosen so the most actionable errors come first (status > capacity
 * > eligibility > wallet) — giving the FE a single message to surface.
 */
export const validateContestJoin = (input: ValidateJoinInput): ContestValidationResult => {
  const issues: ContestValidationIssue[] = [];
  const now = input.now ?? new Date();
  const { contest, match, team } = input;

  // ── Status / lifecycle ──────────────────────────────────────────────
  if (contest.status === ContestStatus.CANCELLED) {
    issues.push(issue(ContestValidationIssueCode.CONTEST_CANCELLED, 'Contest has been cancelled'));
    return { ok: false, issues };
  }
  if (contest.status === ContestStatus.COMPLETED) {
    issues.push(
      issue(ContestValidationIssueCode.CONTEST_NOT_JOINABLE, 'Contest has already finished'),
    );
    return { ok: false, issues };
  }
  if (contest.status === ContestStatus.LIVE || contest.status === ContestStatus.LOCKED) {
    issues.push(issue(ContestValidationIssueCode.CONTEST_LOCKED, 'Contest is locked'));
    return { ok: false, issues };
  }
  if (!isContestJoinable(contest.status)) {
    issues.push(issue(ContestValidationIssueCode.CONTEST_NOT_OPEN, 'Contest is not open for joins'));
    return { ok: false, issues };
  }

  if (!isWindowOpen(contest, match, now)) {
    issues.push(issue(ContestValidationIssueCode.CONTEST_NOT_OPEN, 'Contest join window is closed'));
    return { ok: false, issues };
  }

  if (isMatchPastLock(match, now)) {
    issues.push(issue(ContestValidationIssueCode.MATCH_LOCKED, 'Match has been locked'));
    return { ok: false, issues };
  }

  // ── Capacity ────────────────────────────────────────────────────────
  if (contest.filledSpots >= contest.totalSpots || contest.status === ContestStatus.FULL) {
    issues.push(issue(ContestValidationIssueCode.CONTEST_FULL, 'Contest is full'));
    return { ok: false, issues };
  }

  // ── Visibility / invite code ────────────────────────────────────────
  if (contest.visibility === ContestVisibility.PRIVATE) {
    const supplied = input.inviteCode?.trim().toUpperCase() ?? '';
    if (!supplied) {
      issues.push(
        issue(
          ContestValidationIssueCode.CONTEST_INVITE_CODE_REQUIRED,
          'Invite code is required for private contests',
        ),
      );
      return { ok: false, issues };
    }
    if (!contest.inviteCode || contest.inviteCode.toUpperCase() !== supplied) {
      issues.push(
        issue(ContestValidationIssueCode.CONTEST_INVITE_CODE_INVALID, 'Invite code is invalid'),
      );
      return { ok: false, issues };
    }
  }

  // ── Team ownership / validity ───────────────────────────────────────
  if (!team) {
    issues.push(issue(ContestValidationIssueCode.TEAM_INVALID_FOR_CONTEST, 'Team not found'));
    return { ok: false, issues };
  }
  if (String(team.userId) !== String(input.userId)) {
    issues.push(issue(ContestValidationIssueCode.TEAM_NOT_OWNED, 'Team is not owned by user'));
    return { ok: false, issues };
  }
  if (String(team.matchId) !== String(contest.matchId)) {
    issues.push(
      issue(
        ContestValidationIssueCode.TEAM_INVALID_FOR_CONTEST,
        'Team belongs to a different match',
      ),
    );
    return { ok: false, issues };
  }
  if (team.sport !== contest.sport || team.format !== contest.format) {
    issues.push(
      issue(
        ContestValidationIssueCode.TEAM_INVALID_FOR_CONTEST,
        'Team sport / format does not match the contest',
      ),
    );
    return { ok: false, issues };
  }
  if (
    team.status === FantasyTeamStatus.LOCKED ||
    team.status === FantasyTeamStatus.INVALIDATED
  ) {
    issues.push(issue(ContestValidationIssueCode.TEAM_LOCKED, 'Team is locked or invalidated'));
    return { ok: false, issues };
  }

  // ── Duplicate ───────────────────────────────────────────────────────
  if (input.teamAlreadyJoined) {
    issues.push(
      issue(ContestValidationIssueCode.TEAM_ALREADY_JOINED, 'This team is already in the contest'),
    );
    return { ok: false, issues };
  }

  // ── Per-user entry limit ────────────────────────────────────────────
  const effectiveLimit =
    contest.type === ContestType.HEAD_TO_HEAD ? 1 : contest.maxEntriesPerUser;
  if (input.existingActiveEntries >= effectiveLimit) {
    issues.push(
      issue(
        ContestValidationIssueCode.USER_ENTRY_LIMIT_REACHED,
        `You can join this contest with at most ${effectiveLimit} team${effectiveLimit > 1 ? 's' : ''}`,
      ),
    );
    return { ok: false, issues };
  }

  // ── Wallet ──────────────────────────────────────────────────────────
  if (!contest.isPractice && contest.entryFee > 0) {
    if (input.spendableWalletBalance < contest.entryFee) {
      issues.push(
        issue(
          ContestValidationIssueCode.WALLET_INSUFFICIENT,
          'Insufficient wallet balance to join this contest',
        ),
      );
      return { ok: false, issues };
    }
  }

  return { ok: true, issues: [] };
};

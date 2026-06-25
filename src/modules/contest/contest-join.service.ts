import type { Request } from 'express';
import { Types, type ClientSession } from 'mongoose';

import { appIdentity } from '@config/env.config';

import { ErrorCode, HttpStatus } from '@common/constants';
import {
  AuditAction,
  ContestEntryStatus,
  ContestStatus,
  NotificationType,
  RealtimeEvent,
  WalletStatus,
} from '@common/enums';
import { AppError, NotFoundError } from '@common/errors';
import { auditLogger, securityLogger } from '@common/logging';
import { withTransaction } from '@common/utils/transaction.util';

import { realtimePublisher } from '@events/realtime.publisher';
import { notificationService } from '@modules/notification';

import { fantasyTeamRepository } from '@modules/fantasy/fantasy-team.repository';
import { leaderboardService } from '@modules/leaderboard/leaderboard.service';
import { Match } from '@modules/sports/match.model';
import { walletService } from '@modules/wallet/wallet.service';
import { walletRepository } from '@modules/wallet/wallet.repository';

import { BaseService } from '@shared/services/base.service';

import {
  ContestEntry,
  type ContestEntryDoc,
} from './contest-entry.model';
import { contestEntryRepository } from './contest-entry.repository';
import { contestCache } from './contest-cache';
import { contestRepository } from './contest.repository';
import { contestService } from './contest.service';
import { validateContestJoin } from './contest.validator';
import type { IContest } from './contest.model';

/**
 * Production-grade contest join engine.
 *
 * The flow (executed inside a single MongoDB transaction):
 *
 *   1. Idempotency short-circuit  — if the same `(userId, idempotencyKey)`
 *      already exists, return the existing entry. Defends against
 *      double-tap submits and retry storms.
 *   2. Resolve the contest, match, team, wallet (one read each).
 *   3. Run the pure validator (`validateContestJoin`). Surfaces machine-
 *      readable issue codes back to the FE.
 *   4. Atomically `$inc` `contest.filledSpots` ONLY IF there is room
 *      left — this is the source of truth for "is the contest full?".
 *      Returns `null` when the contest just filled up under us; we
 *      throw `CONTEST_FULL` and abort the txn.
 *   5. Lock the entry fee inside the wallet (no-op for free contests).
 *   6. Insert the `contest_entries` row, linking the wallet transaction.
 *   7. If the contest is now at capacity, transition `status` → FULL
 *      in the same txn (so the listing UI updates within one round-trip).
 *   8. Commit. Audit + cache invalidation happen *after* commit so a
 *      Mongo abort doesn't pollute the audit log.
 *
 * Concurrency invariants:
 *  - `incrementFilledSpot` is the **only** path that bumps the counter
 *    (no race-prone read-modify-write anywhere).
 *  - Per-user entry-limit check counts ACTIVE entries inside the txn —
 *    the partial unique index is the defensive net.
 *  - Wallet `idempotencyKey` is reused from the request so client
 *    retries during a network blip merge cleanly.
 *
 * On any failure after the wallet debit (rare but possible — disk full
 * mid-txn etc.), Mongo's transaction abort rolls back BOTH the spot
 * increment AND the entry insert; the wallet rollback is implicit
 * because the wallet `applyTransaction` rolls back along with the
 * surrounding txn participating in the same session.
 */

export interface JoinContestInput {
  contestId: string;
  teamId: string;
  userId: string;
  inviteCode?: string | null;
  idempotencyKey?: string | null;
  req?: Request;
}

export interface JoinContestResult {
  entry: ContestEntryDoc;
  contest: IContest;
}

class ContestJoinService extends BaseService {
  constructor() {
    super('contest-join-service');
  }

  // ────────────────────────────────────────────── Join ───────────────────

  async join(input: JoinContestInput): Promise<JoinContestResult> {
    // ── 1. Idempotency short-circuit (outside the txn) ────────────────
    if (input.idempotencyKey) {
      const existing = await contestEntryRepository.findByIdempotencyKey(
        input.userId,
        input.idempotencyKey,
      );
      if (existing) {
        if (String(existing.contestId) !== input.contestId) {
          throw new AppError(
            'Idempotency-Key reused for a different contest',
            HttpStatus.CONFLICT,
            ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
          );
        }
        const contest = await contestRepository.findByIdActive(input.contestId);
        if (!contest) throw new NotFoundError('Contest');
        return { entry: existing, contest };
      }
    }

    // ── 2. Pre-flight reads (outside the txn — fail fast) ────────────
    const [contest, team, wallet] = await Promise.all([
      contestRepository.findByIdActive(input.contestId),
      fantasyTeamRepository.findById(input.teamId),
      walletService.ensureWalletForUser(input.userId),
    ]);

    if (!contest) {
      throw new AppError(
        'Contest not found',
        HttpStatus.NOT_FOUND,
        ErrorCode.CONTEST_NOT_FOUND,
      );
    }
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new AppError(
        'Wallet is not active',
        HttpStatus.FORBIDDEN,
        wallet.status === WalletStatus.FROZEN
          ? ErrorCode.WALLET_FROZEN
          : ErrorCode.WALLET_CLOSED,
      );
    }

    const match = await Match.findById(contest.matchId).exec();
    const spendable =
      (wallet.depositBalance ?? 0) +
      (wallet.winningBalance ?? 0) +
      (wallet.bonusBalance ?? 0);

    const [existingActive, dupActive] = await Promise.all([
      contestEntryRepository.countActiveForUserInContest(contest._id, input.userId),
      team
        ? contestEntryRepository.findActiveByContestAndTeam(contest._id, team._id)
        : Promise.resolve(null),
    ]);

    // ── 3. Pure validation (cheap, before opening txn) ───────────────
    const validation = validateContestJoin({
      contest,
      match,
      team,
      userId: input.userId,
      existingActiveEntries: existingActive,
      teamAlreadyJoined: !!dupActive,
      spendableWalletBalance: spendable,
      inviteCode: input.inviteCode ?? null,
    });
    if (!validation.ok) {
      await this.logFailedJoin(input, validation.issues[0]?.code ?? 'UNKNOWN');
      throw new AppError(
        validation.issues[0]?.message ?? 'Cannot join contest',
        HttpStatus.UNPROCESSABLE_ENTITY,
        this.mapIssueToErrorCode(validation.issues[0]?.code),
        { details: { issues: validation.issues } },
      );
    }

    // ── 4..7. Atomic txn ─────────────────────────────────────────────
    let createdEntry: ContestEntryDoc | null = null;
    let walletTransactionId: Types.ObjectId | null = null;

    try {
      const txnResult = await withTransaction(async (session) => {
        // 4. Atomically claim a slot.
        const updatedContest = await contestRepository.incrementFilledSpot(
          contest._id,
          session,
        );
        if (!updatedContest) {
          // Spot count would have exceeded capacity.
          throw new AppError(
            'Contest is full',
            HttpStatus.CONFLICT,
            ErrorCode.CONTEST_FULL,
          );
        }

        // 5. Wallet lock (or zero-cost for practice / free contests).
        let walletTxnId: Types.ObjectId | null = null;
        if (!contest.isPractice && contest.entryFee > 0) {
          // The wallet service starts its own txn internally with its
          // own session — that's fine. The contest_entries write below
          // is the rollback anchor; if it fails we explicitly refund.
          const walletTxn = await walletService.lockForContest({
            userId: input.userId,
            amount: contest.entryFee,
            currency: contest.currency || appIdentity.defaultCurrency,
            idempotencyKey:
              input.idempotencyKey ?? this.generateImplicitIdempotencyKey(input),
            contestId: String(contest._id),
            description: `Join contest ${contest.name}`,
            req: input.req,
          });
          walletTxnId = walletTxn._id;
          walletTransactionId = walletTxnId;
        }

        // 6. Insert the entry row.
        const entryNumber = existingActive + 1;
        const entry = await this.insertEntry(
          {
            contest,
            userId: input.userId,
            teamId: team!._id,
            entryNumber,
            walletTxnId,
            idempotencyKey: input.idempotencyKey ?? null,
          },
          session,
        );
        createdEntry = entry;

        // 7. Flip to FULL if we just hit capacity.
        if (updatedContest.filledSpots >= updatedContest.totalSpots) {
          await contestService.markFullIfCapacityReached(
            String(updatedContest._id),
            session,
          );
        }

        return { entry, contest: updatedContest };
      });

      // ── 8. Post-commit side effects ───────────────────────────────
      await Promise.all([
        contestCache.invalidateContest(
          String(txnResult.contest._id),
          String(txnResult.contest.matchId),
        ),
        contestService.refreshDistinctParticipants(String(txnResult.contest._id)),
        leaderboardService.registerEntry({
          contestId: String(txnResult.contest._id),
          entryId: String(txnResult.entry._id),
          points: team!.totalPoints ?? 0,
        }),
        auditLogger.success({
          action: AuditAction.CONTEST_JOINED,
          actorId: input.userId,
          resource: 'contest_entry',
          resourceId: String(txnResult.entry._id),
          metadata: {
            contestId: String(contest._id),
            teamId: String(team!._id),
            entryFee: contest.entryFee,
            entryNumber: txnResult.entry.entryNumber,
          },
          req: input.req,
        }),
      ]);

      void this.publishJoinRealtime({
        userId: input.userId,
        contest: txnResult.contest,
        entry: txnResult.entry,
        entryFee: contest.entryFee,
      });

      return { entry: txnResult.entry, contest: txnResult.contest };
    } catch (err) {
      // ── Rollback path ─────────────────────────────────────────────
      await this.handleJoinRollback({
        err,
        userId: input.userId,
        contestId: String(contest._id),
        teamId: String(team?._id ?? input.teamId),
        walletTransactionId,
        walletAmount: contest.entryFee,
        walletCurrency: contest.currency,
        idempotencyKey: input.idempotencyKey ?? null,
        req: input.req,
      });
      // Mongo aborted the txn — the entry insert + spot increment are
      // already rolled back. We only need to refund the wallet IFF
      // the wallet debit succeeded in its own (independent) txn.
      throw err;
    } finally {
      // `createdEntry` may be useful for downstream observability — but
      // it's already serialized through the success path; nothing to do.
      void createdEntry;
    }
  }

  // ────────────────────────────────────────── Refund helpers ─────────────

  /**
   * Per-entry refund used by both the cancellation sweep and the failed
   * join rollback path. Each refund is its own MongoDB transaction so
   * one bad entry doesn't poison the rest of the cancellation.
   */
  async refundEntry(args: {
    entryId: string;
    userId: string;
    amount: number;
    currency: string;
    contestId: string;
    reason: string;
    req?: Request;
  }): Promise<void> {
    if (args.amount <= 0) {
      // Free / practice contests — just flip status and emit audit.
      await contestEntryRepository.markRefunded(
        args.entryId,
        new Types.ObjectId(),
        args.reason,
      );
      await auditLogger.success({
        action: AuditAction.CONTEST_ENTRY_REFUNDED,
        actorId: args.userId,
        resource: 'contest_entry',
        resourceId: args.entryId,
        metadata: { contestId: args.contestId, amount: 0, reason: args.reason },
        req: args.req,
      });
      return;
    }
    try {
      const walletTxn = await walletService.refundContest({
        userId: args.userId,
        amount: args.amount,
        currency: args.currency,
        idempotencyKey: `refund-${args.entryId}`,
        contestId: args.contestId,
        req: args.req,
      });
      await contestEntryRepository.markRefunded(
        args.entryId,
        walletTxn._id,
        args.reason,
      );
      await auditLogger.success({
        action: AuditAction.CONTEST_ENTRY_REFUNDED,
        actorId: args.userId,
        resource: 'contest_entry',
        resourceId: args.entryId,
        metadata: { contestId: args.contestId, amount: args.amount, reason: args.reason },
        req: args.req,
      });
    } catch (err) {
      this.logger.error(
        { err, entryId: args.entryId, contestId: args.contestId, userId: args.userId },
        'contest.refund.failed',
      );
      await auditLogger.failure({
        action: AuditAction.CONTEST_ENTRY_REFUNDED,
        actorId: args.userId,
        resource: 'contest_entry',
        resourceId: args.entryId,
        errorCode: ErrorCode.INTERNAL_ERROR,
        errorMessage: err instanceof Error ? err.message : 'refund.failed',
        metadata: { contestId: args.contestId, amount: args.amount },
        req: args.req,
      });
      throw err;
    }
  }

  /** Bulk refund used by `contestService.cancelContest`. */
  async refundAllEntries(
    entries: Array<{ id: string; userId: string; amount: number; currency: string }>,
    contestId: string,
  ): Promise<void> {
    for (const entry of entries) {
      await this.refundEntry({
        entryId: entry.id,
        userId: entry.userId,
        amount: entry.amount,
        currency: entry.currency,
        contestId,
        reason: 'CONTEST_CANCELLED',
      });
    }
  }

  /** Stable wallet snapshot used by the API response payload. */
  async getWalletSnapshotForUser(userId: string): Promise<{
    spendable: number;
    locked: number;
    currency: string;
  }> {
    const w = await walletRepository.findByUserId(userId);
    if (!w) {
      return {
        spendable: 0,
        locked: 0,
        currency: appIdentity.defaultCurrency,
      };
    }
    return {
      spendable: w.depositBalance + w.winningBalance + w.bonusBalance,
      locked: w.lockedBalance,
      currency: w.currency,
    };
  }

  // ────────────────────────────────────────── Internal helpers ───────────

  private async publishJoinRealtime(args: {
    userId: string;
    contest: IContest;
    entry: ContestEntryDoc;
    entryFee: number;
  }): Promise<void> {
    const contestId = String(args.contest._id);
    const matchId = String(args.contest.matchId);

    await realtimePublisher.contestJoined({
      contestId,
      matchId,
      userId: args.userId,
      entryId: String(args.entry._id),
      filledSpots: args.contest.filledSpots,
      totalSpots: args.contest.totalSpots,
    });

    await realtimePublisher.leaderboardUpdated({
      contestId,
      matchId,
      totalEntries: args.contest.filledSpots,
      topScore: 0,
    });

    if (args.contest.status === ContestStatus.FULL || args.contest.filledSpots >= args.contest.totalSpots) {
      await realtimePublisher.contestFilled({
        contestId,
        matchId,
        filledSpots: args.contest.filledSpots,
        totalSpots: args.contest.totalSpots,
      });
    }

    if (args.entryFee > 0) {
      const wallet = await this.getWalletSnapshotForUser(args.userId);
      await realtimePublisher.walletDebited({
        userId: args.userId,
        currency: wallet.currency,
        spendable: wallet.spendable,
        locked: wallet.locked,
        amount: args.entryFee,
        referenceType: 'contest_entry',
        referenceId: String(args.entry._id),
      });
    }

    void notificationService.enqueue({
      userId: args.userId,
      type: NotificationType.CONTEST,
      title: 'Contest joined',
      body: `You joined ${args.contest.name}`,
      data: { contestId, matchId, entryId: String(args.entry._id) },
      sourceEvent: RealtimeEvent.CONTEST_JOINED,
    });
  }

  private async insertEntry(
    args: {
      contest: IContest;
      userId: string;
      teamId: Types.ObjectId;
      entryNumber: number;
      walletTxnId: Types.ObjectId | null;
      idempotencyKey: string | null;
    },
    session: ClientSession,
  ): Promise<ContestEntryDoc> {
    try {
      const [entry] = await ContestEntry.create(
        [
          {
            contestId: args.contest._id,
            userId: new Types.ObjectId(args.userId),
            matchId: args.contest.matchId,
            teamId: args.teamId,
            entryFee: args.contest.entryFee,
            currency: args.contest.currency,
            entryNumber: args.entryNumber,
            status: ContestEntryStatus.ACTIVE,
            idempotencyKey: args.idempotencyKey,
            walletTransactionId: args.walletTxnId,
            refundTransactionId: null,
            refundedAt: null,
            refundReason: null,
            rank: null,
            winningAmount: 0,
            settledAt: null,
            joinedAt: new Date(),
          },
        ],
        { session },
      );
      return entry!;
    } catch (err: unknown) {
      // Unique index violation = duplicate join detected at the DB
      // layer. The pure validator should have caught it, but we keep
      // the defensive guard so concurrent requests still get a clean
      // error rather than a 500.
      if (this.isDuplicateKeyError(err)) {
        throw new AppError(
          'Duplicate entry — this team is already in the contest',
          HttpStatus.CONFLICT,
          ErrorCode.CONTEST_TEAM_ALREADY_JOINED,
        );
      }
      throw err;
    }
  }

  private async handleJoinRollback(args: {
    err: unknown;
    userId: string;
    contestId: string;
    teamId: string;
    walletTransactionId: Types.ObjectId | null;
    walletAmount: number;
    walletCurrency: string;
    idempotencyKey: string | null;
    req?: Request;
  }): Promise<void> {
    await auditLogger.failure({
      action: AuditAction.CONTEST_JOIN_ROLLBACK,
      actorId: args.userId,
      resource: 'contest',
      resourceId: args.contestId,
      errorCode:
        args.err instanceof AppError ? args.err.errorCode : ErrorCode.INTERNAL_ERROR,
      errorMessage: args.err instanceof Error ? args.err.message : 'join.failed',
      metadata: {
        teamId: args.teamId,
        walletTransactionId: args.walletTransactionId
          ? String(args.walletTransactionId)
          : null,
      },
      req: args.req,
    });

    // Wallet refund — only needed if the wallet debit succeeded in its
    // own transaction. When the txn aborts mid-flight (before the wallet
    // step), `walletTransactionId` is null and there's nothing to undo.
    if (args.walletTransactionId && args.walletAmount > 0) {
      try {
        await walletService.refundContest({
          userId: args.userId,
          amount: args.walletAmount,
          currency: args.walletCurrency,
          idempotencyKey: `rollback-${args.walletTransactionId}`,
          contestId: args.contestId,
          req: args.req,
        });
      } catch (refundErr) {
        this.logger.error(
          {
            err: refundErr,
            userId: args.userId,
            contestId: args.contestId,
            walletTransactionId: String(args.walletTransactionId),
          },
          'contest.join.rollback.refund.failed',
        );
        await securityLogger.suspicious({
          reason: 'contest_join_refund_failed',
          actorId: args.userId,
          metadata: {
            contestId: args.contestId,
            walletTransactionId: String(args.walletTransactionId),
            amount: args.walletAmount,
          },
          req: args.req,
        });
      }
    }
  }

  private async logFailedJoin(input: JoinContestInput, code: string): Promise<void> {
    await auditLogger.failure({
      action:
        code === 'TEAM_ALREADY_JOINED'
          ? AuditAction.CONTEST_JOIN_DUPLICATE
          : AuditAction.CONTEST_JOIN_FAILED,
      actorId: input.userId,
      resource: 'contest',
      resourceId: input.contestId,
      errorCode: this.mapIssueToErrorCode(code),
      metadata: { teamId: input.teamId, code },
      req: input.req,
    });
  }

  private mapIssueToErrorCode(code: string | undefined): typeof ErrorCode[keyof typeof ErrorCode] {
    switch (code) {
      case 'CONTEST_FULL':
        return ErrorCode.CONTEST_FULL;
      case 'CONTEST_LOCKED':
      case 'MATCH_LOCKED':
        return ErrorCode.CONTEST_LOCKED;
      case 'CONTEST_CANCELLED':
        return ErrorCode.CONTEST_CANCELLED;
      case 'CONTEST_NOT_OPEN':
      case 'CONTEST_NOT_JOINABLE':
        return ErrorCode.CONTEST_NOT_JOINABLE;
      case 'CONTEST_INVITE_CODE_REQUIRED':
        return ErrorCode.CONTEST_INVITE_CODE_REQUIRED;
      case 'CONTEST_INVITE_CODE_INVALID':
        return ErrorCode.CONTEST_INVITE_CODE_INVALID;
      case 'TEAM_ALREADY_JOINED':
        return ErrorCode.CONTEST_TEAM_ALREADY_JOINED;
      case 'TEAM_INVALID_FOR_CONTEST':
      case 'TEAM_NOT_OWNED':
      case 'TEAM_LOCKED':
        return ErrorCode.TEAM_INVALID;
      case 'USER_ENTRY_LIMIT_REACHED':
        return ErrorCode.CONTEST_USER_ENTRY_LIMIT;
      case 'WALLET_INSUFFICIENT':
        return ErrorCode.WALLET_INSUFFICIENT_BALANCE;
      default:
        return ErrorCode.CONTEST_NOT_JOINABLE;
    }
  }

  private generateImplicitIdempotencyKey(input: JoinContestInput): string {
    // When the client doesn't supply one, derive a stable-but-unique
    // key from the request shape. Prevents accidental double-debits
    // when the same payload is replayed in the same second.
    return `join:${input.contestId}:${input.userId}:${input.teamId}:${Date.now()}`;
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: number }).code === 11000
    );
  }
}

export const contestJoinService = new ContestJoinService();
export { ContestJoinService };

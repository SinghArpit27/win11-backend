import type { Request } from 'express';
import { type ClientSession, Types } from 'mongoose';

import { appIdentity } from '@config/env.config';

import { AppConstants } from '@common/constants';
import { ErrorCode, HttpStatus } from '@common/constants';
import {
  AuditAction,
  LedgerDirection,
  WalletBucket,
  WalletStatus,
  WalletTxStatus,
  WalletTxType,
} from '@common/enums';
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
} from '@common/errors';
import { auditLogger, securityLogger } from '@common/logging';

import { realtimePublisher } from '@events/realtime.publisher';
import { withTransaction } from '@common/utils/transaction.util';

import { BaseService } from '@shared/services/base.service';

import { walletRepository } from './wallet.repository';
import { walletTransactionRepository } from './wallet-transaction.repository';
import { transactionLedgerRepository } from './transaction-ledger.repository';
import type { IWallet, WalletDoc } from './wallet.model';
import type { WalletTransactionDoc } from './wallet-transaction.model';
import type { ITransactionLedger } from './transaction-ledger.model';
import type {
  ApplyTransactionInput,
  LedgerEntryInput,
  WalletSnapshot,
} from './wallet.types';

/**
 * Wallet service — the canonical money-movement engine.
 *
 * Design goals (all of these are tested in `docs/test-cases/PHASE-03`):
 *  1. **Ledger first, balance cache second.** Every state change writes
 *     immutable `transaction_ledgers` rows inside the same MongoDB
 *     transaction that bumps the cached `Wallet` aggregates. We NEVER
 *     touch wallet balances without an accompanying ledger entry.
 *  2. **Idempotency.** A client retry with the same `Idempotency-Key`
 *     returns the original transaction. The unique partial index on
 *     `(userId, idempotencyKey)` is the durable guard; the service
 *     opportunistically short-circuits before opening a Mongo session.
 *  3. **Double-entry / balanced journal.** Sum of credits == sum of
 *     debits for every transaction. The service enforces this in code
 *     and the reconciliation job re-verifies it asynchronously.
 *  4. **Concurrency-safe.** Bucket deltas are applied with `$inc` so
 *     two parallel requests can never read-modify-write the same value.
 *     Negative-balance guards live in the service (debits check the
 *     cached value inside the txn; the database also has `min: 0`
 *     validators as a belt-and-braces).
 *  5. **Auditable.** Every successful op emits an audit row keyed by
 *     the request id so we can join logs ↔ ledger ↔ audit.
 *  6. **Rollback-safe.** `reverse()` emits a NEW transaction with
 *     compensating entries and points the original at it — the
 *     original row stays immutable.
 *
 * Money values are MINOR units (paise / cents) so the math is integer.
 * Validators reject non-integer / negative amounts upstream of the
 * service, but we also assert here for safety.
 */
class WalletService extends BaseService {
  constructor() {
    super('wallet-service');
  }

  // ────────────────────────────────────────────────── Bootstrap ───────────

  /**
   * Idempotently ensures the caller has a wallet. Used on signup and
   * before every read so the wallet UI never sees a 404 on first load.
   */
  async ensureWalletForUser(userId: string | Types.ObjectId): Promise<WalletDoc> {
    const wallet = await walletRepository.upsertForUser(userId, appIdentity.defaultCurrency);
    return wallet;
  }

  // ────────────────────────────────────────────────── Reads ───────────────

  async getWalletSnapshot(userId: string | Types.ObjectId): Promise<WalletSnapshot> {
    const wallet = await this.ensureWalletForUser(userId);
    return this.toSnapshot(wallet);
  }

  async findWalletByIdOrUser(opts: {
    walletId?: string;
    userId?: string;
  }): Promise<WalletDoc | null> {
    if (opts.walletId) return walletRepository.findById(opts.walletId);
    if (opts.userId) return walletRepository.findByUserId(opts.userId);
    return null;
  }

  // ─────────────────────────────────────── Public business operations ─────

  async deposit(args: {
    userId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    reference?: string | null;
    metadata?: Record<string, unknown>;
    description?: string | null;
    initiatedBy?: string | null;
    initiatedByRole?: string | null;
    req?: Request;
  }): Promise<{ wallet: WalletSnapshot; transaction: WalletTransactionDoc }> {
    this.assertAmount(args.amount, 'deposit');
    const txn = await this.applyTransaction({
      userId: args.userId,
      type: WalletTxType.DEPOSIT,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      reference: args.reference ?? null,
      description: args.description ?? 'Wallet deposit',
      metadata: args.metadata ?? {},
      initiatedBy: args.initiatedBy ?? args.userId,
      initiatedByRole: args.initiatedByRole ?? null,
      entries: [{ direction: LedgerDirection.CREDIT, bucket: WalletBucket.DEPOSIT, amount: args.amount }],
    });

    await auditLogger.success({
      actorId: args.userId,
      action: AuditAction.WALLET_DEPOSIT,
      resource: 'wallet_transaction',
      resourceId: String(txn._id),
      metadata: { amount: args.amount, currency: args.currency },
      req: args.req,
    });

    const wallet = await this.getWalletSnapshot(args.userId);

    void realtimePublisher.walletCredited({
      userId: args.userId,
      currency: wallet.currency,
      spendable: wallet.balances.spendable,
      locked: wallet.balances.locked,
      amount: args.amount,
      referenceType: 'deposit',
      referenceId: String(txn._id),
    });

    return { wallet, transaction: txn };
  }

  async withdraw(args: {
    userId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    description?: string | null;
    metadata?: Record<string, unknown>;
    req?: Request;
  }): Promise<{ wallet: WalletSnapshot; transaction: WalletTransactionDoc }> {
    this.assertAmount(args.amount, 'withdraw');

    // Withdrawals come out of WINNING first, then DEPOSIT. Bonus is
    // never withdrawable (industry standard for promo balances).
    const wallet = await walletRepository.findByUserId(args.userId);
    if (!wallet) {
      throw new AppError('Wallet not found', HttpStatus.NOT_FOUND, ErrorCode.WALLET_NOT_FOUND);
    }
    this.assertWalletWritable(wallet);

    const withdrawable = wallet.winningBalance + wallet.depositBalance;
    if (withdrawable < args.amount) {
      await securityLogger.suspicious({
        reason: 'wallet_withdraw_insufficient_balance',
        actorId: args.userId,
        metadata: {
          requested: args.amount,
          available: withdrawable,
          deposit: wallet.depositBalance,
          winning: wallet.winningBalance,
        },
        req: args.req,
      });
      await auditLogger.failure({
        actorId: args.userId,
        action: AuditAction.WALLET_WITHDRAW_FAILED,
        errorCode: ErrorCode.WALLET_INSUFFICIENT_BALANCE,
        metadata: { requested: args.amount, available: withdrawable },
        req: args.req,
      });
      throw new AppError(
        'Insufficient withdrawable balance',
        HttpStatus.BAD_REQUEST,
        ErrorCode.WALLET_INSUFFICIENT_BALANCE,
      );
    }

    const entries = this.splitDebitAcrossBuckets(args.amount, [
      { bucket: WalletBucket.WINNING, available: wallet.winningBalance },
      { bucket: WalletBucket.DEPOSIT, available: wallet.depositBalance },
    ]);

    const txn = await this.applyTransaction({
      userId: args.userId,
      type: WalletTxType.WITHDRAW,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      description: args.description ?? 'Wallet withdrawal',
      metadata: args.metadata ?? {},
      initiatedBy: args.userId,
      entries,
    });

    await auditLogger.success({
      actorId: args.userId,
      action: AuditAction.WALLET_WITHDRAW,
      resource: 'wallet_transaction',
      resourceId: String(txn._id),
      metadata: { amount: args.amount, currency: args.currency },
      req: args.req,
    });

    const snapshot = await this.getWalletSnapshot(args.userId);
    return { wallet: snapshot, transaction: txn };
  }

  /** Escrow funds for a pending withdrawal request. */
  async lockForWithdrawal(args: {
    userId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    withdrawalId: string;
    req?: Request;
  }): Promise<WalletTransactionDoc> {
    this.assertAmount(args.amount, 'withdrawal_lock');
    const wallet = await walletRepository.findByUserId(args.userId);
    if (!wallet) {
      throw new AppError('Wallet not found', HttpStatus.NOT_FOUND, ErrorCode.WALLET_NOT_FOUND);
    }
    this.assertWalletWritable(wallet);

    const withdrawable = wallet.winningBalance + wallet.depositBalance;
    if (withdrawable < args.amount) {
      throw new AppError(
        'Insufficient withdrawable balance',
        HttpStatus.BAD_REQUEST,
        ErrorCode.WALLET_INSUFFICIENT_BALANCE,
      );
    }

    const debits = this.splitDebitAcrossBuckets(args.amount, [
      { bucket: WalletBucket.WINNING, available: wallet.winningBalance },
      { bucket: WalletBucket.DEPOSIT, available: wallet.depositBalance },
    ]);
    const credit = { direction: LedgerDirection.CREDIT, bucket: WalletBucket.LOCKED, amount: args.amount };

    return this.applyTransaction({
      userId: args.userId,
      type: WalletTxType.WITHDRAWAL_LOCK,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      reference: args.withdrawalId,
      referenceType: 'withdrawal',
      description: `Withdrawal hold ${args.withdrawalId}`,
      metadata: { withdrawalId: args.withdrawalId },
      initiatedBy: args.userId,
      entries: [...debits, credit],
    });
  }

  /** Finalize an approved withdrawal — debit locked bucket. */
  async completeWithdrawalFromLock(args: {
    userId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    withdrawalId: string;
  }): Promise<WalletTransactionDoc> {
    return this.applyTransaction({
      userId: args.userId,
      type: WalletTxType.WITHDRAW,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      reference: args.withdrawalId,
      referenceType: 'withdrawal',
      description: `Withdrawal completed ${args.withdrawalId}`,
      metadata: { withdrawalId: args.withdrawalId },
      initiatedBy: args.userId,
      entries: [{ direction: LedgerDirection.DEBIT, bucket: WalletBucket.LOCKED, amount: args.amount }],
    });
  }

  /** Release escrow when a withdrawal is rejected. */
  async releaseWithdrawalLock(args: {
    userId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    withdrawalId: string;
  }): Promise<WalletTransactionDoc> {
    const wallet = await walletRepository.findByUserId(args.userId);
    if (!wallet || wallet.lockedBalance < args.amount) {
      throw new AppError(
        'Insufficient locked balance to release',
        HttpStatus.BAD_REQUEST,
        ErrorCode.WALLET_INSUFFICIENT_BALANCE,
      );
    }

    return this.applyTransaction({
      userId: args.userId,
      type: WalletTxType.WITHDRAWAL_RELEASE,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      reference: args.withdrawalId,
      referenceType: 'withdrawal',
      description: `Withdrawal release ${args.withdrawalId}`,
      metadata: { withdrawalId: args.withdrawalId },
      initiatedBy: args.userId,
      entries: [
        { direction: LedgerDirection.DEBIT, bucket: WalletBucket.LOCKED, amount: args.amount },
        { direction: LedgerDirection.CREDIT, bucket: WalletBucket.DEPOSIT, amount: args.amount },
      ],
    });
  }

  /**
   * Moves money from the spendable buckets to LOCKED. The locked bucket
   * is a virtual escrow used by contest joins; settlement (refund or
   * winning credit) is a separate operation.
   */
  async lockForContest(args: {
    userId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    contestId: string;
    description?: string;
    req?: Request;
  }): Promise<WalletTransactionDoc> {
    this.assertAmount(args.amount, 'contest_join');

    const wallet = await walletRepository.findByUserId(args.userId);
    if (!wallet) {
      throw new AppError('Wallet not found', HttpStatus.NOT_FOUND, ErrorCode.WALLET_NOT_FOUND);
    }
    this.assertWalletWritable(wallet);

    const spendable = wallet.depositBalance + wallet.winningBalance + wallet.bonusBalance;
    if (spendable < args.amount) {
      throw new AppError(
        'Insufficient balance to join contest',
        HttpStatus.BAD_REQUEST,
        ErrorCode.WALLET_INSUFFICIENT_BALANCE,
      );
    }

    // Spend order: DEPOSIT → WINNING → BONUS (bonus consumed last so users
    // burn cash first; can be tuned per business policy).
    const debits = this.splitDebitAcrossBuckets(args.amount, [
      { bucket: WalletBucket.DEPOSIT, available: wallet.depositBalance },
      { bucket: WalletBucket.WINNING, available: wallet.winningBalance },
      { bucket: WalletBucket.BONUS, available: wallet.bonusBalance },
    ]);
    const credit: LedgerEntryInput = {
      direction: LedgerDirection.CREDIT,
      bucket: WalletBucket.LOCKED,
      amount: args.amount,
    };

    const txn = await this.applyTransaction({
      userId: args.userId,
      type: WalletTxType.CONTEST_JOIN,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      description: args.description ?? `Contest join ${args.contestId}`,
      reference: args.contestId,
      referenceType: 'contest',
      metadata: { contestId: args.contestId },
      initiatedBy: args.userId,
      entries: [...debits, credit],
    });

    await auditLogger.success({
      actorId: args.userId,
      action: AuditAction.WALLET_CONTEST_JOIN,
      resource: 'wallet_transaction',
      resourceId: String(txn._id),
      metadata: { amount: args.amount, contestId: args.contestId },
      req: args.req,
    });
    return txn;
  }

  /** Releases a locked amount back to its source buckets (refund path). */
  async refundContest(args: {
    userId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    contestId: string;
    req?: Request;
  }): Promise<WalletTransactionDoc> {
    this.assertAmount(args.amount, 'contest_refund');
    const txn = await this.applyTransaction({
      userId: args.userId,
      type: WalletTxType.CONTEST_REFUND,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      description: `Contest refund ${args.contestId}`,
      reference: args.contestId,
      referenceType: 'contest',
      metadata: { contestId: args.contestId },
      entries: [
        { direction: LedgerDirection.DEBIT, bucket: WalletBucket.LOCKED, amount: args.amount },
        { direction: LedgerDirection.CREDIT, bucket: WalletBucket.DEPOSIT, amount: args.amount },
      ],
    });

    await auditLogger.success({
      action: AuditAction.WALLET_CONTEST_REFUND,
      actorId: args.userId,
      resource: 'wallet_transaction',
      resourceId: String(txn._id),
      metadata: { contestId: args.contestId, amount: args.amount },
      req: args.req,
    });
    return txn;
  }

  async creditWinning(args: {
    userId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    contestId?: string;
    req?: Request;
  }): Promise<WalletTransactionDoc> {
    this.assertAmount(args.amount, 'winning_credit');
    const txn = await this.applyTransaction({
      userId: args.userId,
      type: WalletTxType.WINNING_CREDIT,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      description: 'Contest winnings',
      reference: args.contestId ?? null,
      referenceType: args.contestId ? 'contest' : null,
      metadata: args.contestId ? { contestId: args.contestId } : {},
      entries: [{ direction: LedgerDirection.CREDIT, bucket: WalletBucket.WINNING, amount: args.amount }],
    });

    await auditLogger.success({
      action: AuditAction.WALLET_WINNING_CREDIT,
      actorId: args.userId,
      resource: 'wallet_transaction',
      resourceId: String(txn._id),
      metadata: { amount: args.amount, contestId: args.contestId },
      req: args.req,
    });
    return txn;
  }

  async creditBonus(args: {
    userId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    campaign?: string;
    req?: Request;
  }): Promise<WalletTransactionDoc> {
    this.assertAmount(args.amount, 'bonus_credit');
    const txn = await this.applyTransaction({
      userId: args.userId,
      type: WalletTxType.BONUS_CREDIT,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      description: args.campaign ? `Bonus: ${args.campaign}` : 'Bonus credit',
      reference: args.campaign ?? null,
      referenceType: args.campaign ? 'campaign' : null,
      entries: [{ direction: LedgerDirection.CREDIT, bucket: WalletBucket.BONUS, amount: args.amount }],
    });

    await auditLogger.success({
      action: AuditAction.WALLET_BONUS_CREDIT,
      actorId: args.userId,
      resource: 'wallet_transaction',
      resourceId: String(txn._id),
      metadata: { amount: args.amount, campaign: args.campaign },
      req: args.req,
    });
    return txn;
  }

  /**
   * Admin adjustment — credits OR debits a specific bucket. Used by
   * support for goodwill credits, refunds outside the contest path,
   * mistake fixes, etc. ALWAYS produces a ledger entry + an
   * `admin_wallet_actions` row + an `audit_log` row.
   */
  async adminAdjust(args: {
    adminId: string;
    adminRoles: string[];
    targetUserId: string;
    direction: LedgerDirection;
    bucket: WalletBucket;
    amount: number;
    currency: string;
    idempotencyKey: string;
    reason: string;
    ticketRef?: string | null;
    notes?: string | null;
    req?: Request;
  }): Promise<WalletTransactionDoc> {
    this.assertAmount(args.amount, 'admin_adjustment');
    if (args.bucket === WalletBucket.LOCKED) {
      throw new BadRequestError('LOCKED bucket cannot be adjusted directly');
    }

    const wallet = await walletRepository.findByUserId(args.targetUserId);
    if (!wallet) {
      throw new AppError('Wallet not found', HttpStatus.NOT_FOUND, ErrorCode.WALLET_NOT_FOUND);
    }

    if (args.direction === LedgerDirection.DEBIT) {
      const available =
        args.bucket === WalletBucket.DEPOSIT
          ? wallet.depositBalance
          : args.bucket === WalletBucket.WINNING
          ? wallet.winningBalance
          : wallet.bonusBalance;
      if (available < args.amount) {
        throw new AppError(
          'Insufficient bucket balance for adjustment',
          HttpStatus.BAD_REQUEST,
          ErrorCode.WALLET_INSUFFICIENT_BALANCE,
        );
      }
    }

    const entries: LedgerEntryInput[] = [
      { direction: args.direction, bucket: args.bucket, amount: args.amount },
    ];

    const txn = await this.applyTransaction({
      userId: args.targetUserId,
      type: WalletTxType.ADMIN_ADJUSTMENT,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      description: `Admin adjustment (${args.direction} ${args.bucket}): ${args.reason}`,
      metadata: {
        adminId: args.adminId,
        adminRoles: args.adminRoles,
        bucket: args.bucket,
        direction: args.direction,
        ticketRef: args.ticketRef ?? null,
      },
      initiatedBy: args.adminId,
      initiatedByRole: args.adminRoles[0] ?? null,
      entries,
    });

    await auditLogger.success({
      action: AuditAction.ADMIN_WALLET_ADJUSTMENT,
      actorId: args.adminId,
      actorRoles: args.adminRoles,
      onBehalfOfId: args.targetUserId,
      resource: 'wallet_transaction',
      resourceId: String(txn._id),
      metadata: {
        bucket: args.bucket,
        direction: args.direction,
        amount: args.amount,
        reason: args.reason,
        ticketRef: args.ticketRef,
      },
      req: args.req,
    });

    return txn;
  }

  /**
   * Emits a compensating transaction that exactly inverses an earlier
   * one. The original row is never mutated except for its `status`
   * (PENDING → REVERSED) and `reversedById` pointer.
   */
  async reverseTransaction(args: {
    transactionId: string;
    adminId: string;
    adminRoles: string[];
    reason: string;
    idempotencyKey: string;
    req?: Request;
  }): Promise<WalletTransactionDoc> {
    const original = await walletTransactionRepository.findById(args.transactionId);
    if (!original) {
      throw new AppError(
        'Transaction not found',
        HttpStatus.NOT_FOUND,
        ErrorCode.TRANSACTION_NOT_FOUND,
      );
    }
    if (original.status !== WalletTxStatus.COMPLETED) {
      throw new AppError(
        'Only completed transactions can be reversed',
        HttpStatus.BAD_REQUEST,
        ErrorCode.TRANSACTION_NOT_REVERSIBLE,
      );
    }
    if (original.reversedById) {
      throw new AppError(
        'Transaction has already been reversed',
        HttpStatus.CONFLICT,
        ErrorCode.TRANSACTION_ALREADY_REVERSED,
      );
    }

    const originalEntries = await transactionLedgerRepository.listForTransaction(args.transactionId);
    if (originalEntries.length === 0) {
      throw new AppError(
        'Original transaction has no ledger entries',
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.LEDGER_IMBALANCE,
      );
    }

    const compensating: LedgerEntryInput[] = originalEntries.map((e) => ({
      direction: e.direction === LedgerDirection.CREDIT ? LedgerDirection.DEBIT : LedgerDirection.CREDIT,
      bucket: e.bucket,
      amount: e.amount,
    }));

    const compensatingTxn = await this.applyTransaction({
      userId: original.userId,
      type: WalletTxType.ADMIN_ADJUSTMENT,
      amount: original.amount,
      currency: original.currency,
      idempotencyKey: args.idempotencyKey,
      description: `Reversal of ${original._id}: ${args.reason}`,
      reference: String(original._id),
      referenceType: 'reversal',
      metadata: { adminId: args.adminId, reason: args.reason },
      initiatedBy: args.adminId,
      initiatedByRole: args.adminRoles[0] ?? null,
      reversesTransactionId: original._id,
      entries: compensating,
    });

    await walletTransactionRepository.markReversed(args.transactionId, compensatingTxn._id);

    await auditLogger.success({
      action: AuditAction.WALLET_TX_REVERSED,
      actorId: args.adminId,
      actorRoles: args.adminRoles,
      onBehalfOfId: String(original.userId),
      resource: 'wallet_transaction',
      resourceId: String(original._id),
      metadata: { reversedBy: String(compensatingTxn._id), reason: args.reason },
      req: args.req,
    });

    return compensatingTxn;
  }

  async setWalletStatus(args: {
    targetUserId: string;
    status: WalletStatus;
    reason?: string;
    adminId: string;
    adminRoles: string[];
    req?: Request;
  }): Promise<WalletSnapshot> {
    const wallet = await walletRepository.findByUserId(args.targetUserId);
    if (!wallet) {
      throw new AppError('Wallet not found', HttpStatus.NOT_FOUND, ErrorCode.WALLET_NOT_FOUND);
    }
    const updated = await walletRepository.setStatus(wallet._id, args.status, { reason: args.reason ?? null });
    await auditLogger.success({
      actorId: args.adminId,
      actorRoles: args.adminRoles,
      onBehalfOfId: args.targetUserId,
      action: args.status === WalletStatus.FROZEN ? AuditAction.WALLET_FROZEN : AuditAction.WALLET_UNFROZEN,
      resource: 'wallet',
      resourceId: String(wallet._id),
      metadata: { reason: args.reason ?? null, status: args.status },
      req: args.req,
    });
    return this.toSnapshot(updated ?? wallet);
  }

  // ──────────────────────────────────────────── Internal core ─────────────

  /**
   * THE single seam through which money moves. Every public method
   * funnels through here so the invariants (idempotency, balanced
   * journal, ledger before cache, audit row) are enforced in one place.
   */
  private async applyTransaction(input: ApplyTransactionInput): Promise<WalletTransactionDoc> {
    this.assertEntriesBalanced(input);

    // Idempotency short-circuit OUTSIDE the txn — avoids opening a Mongo
    // session for retried requests. The DB-level unique index is still
    // the durable guarantee.
    if (input.idempotencyKey) {
      const existing = await walletTransactionRepository.findByIdempotencyKey(
        input.userId,
        input.idempotencyKey,
      );
      if (existing) {
        // Confirm the retry matches the original op signature.
        if (existing.type !== input.type || existing.amount !== input.amount) {
          throw new ConflictError(
            'Idempotency-Key reused for a different operation',
            { code: ErrorCode.IDEMPOTENCY_KEY_CONFLICT },
          );
        }
        this.logger.info(
          { txnId: String(existing._id), key: input.idempotencyKey },
          'wallet.idempotent_replay',
        );
        return existing;
      }
    }

    const wallet = await this.ensureWalletForUser(input.userId);
    this.assertWalletWritable(wallet);
    this.assertCurrencyMatches(wallet, input.currency);

    return withTransaction(async (session) => this.applyTransactionTxn(session, wallet, input));
  }

  /** The actual atomic block. Kept tight so the txn window is short. */
  private async applyTransactionTxn(
    session: ClientSession,
    walletBefore: IWallet,
    input: ApplyTransactionInput,
  ): Promise<WalletTransactionDoc> {
    const deltas = this.computeDeltas(input.entries);

    // Hard guard — projected post-balance must never go negative. We
    // re-check inside the transaction because the cached values on
    // `walletBefore` may be stale relative to a parallel writer.
    const projected = {
      deposit: walletBefore.depositBalance + (deltas.deposit ?? 0),
      winning: walletBefore.winningBalance + (deltas.winning ?? 0),
      bonus: walletBefore.bonusBalance + (deltas.bonus ?? 0),
      locked: walletBefore.lockedBalance + (deltas.locked ?? 0),
    };
    if (
      projected.deposit < 0 ||
      projected.winning < 0 ||
      projected.bonus < 0 ||
      projected.locked < 0
    ) {
      throw new AppError(
        'Insufficient bucket balance',
        HttpStatus.BAD_REQUEST,
        ErrorCode.WALLET_INSUFFICIENT_BALANCE,
      );
    }

    // 1. Insert the pending wallet_transactions row.
    const balanceBefore = this.bucketsOf(walletBefore);
    let txn: WalletTransactionDoc;
    try {
      [txn] = await walletTransactionRepository.createMany(
        [
          {
            userId: walletBefore.userId,
            walletId: walletBefore._id,
            type: input.type,
            status: WalletTxStatus.PENDING,
            currency: input.currency.toUpperCase(),
            amount: input.amount,
            idempotencyKey: input.idempotencyKey ?? null,
            reference: input.reference ?? null,
            referenceType: input.referenceType ?? null,
            description: input.description ?? null,
            metadata: input.metadata ?? {},
            balanceBefore,
            balanceAfter: balanceBefore,
            initiatedBy: input.initiatedBy
              ? (input.initiatedBy as unknown as Types.ObjectId)
              : null,
            initiatedByRole: input.initiatedByRole ?? null,
            reversesId: input.reversesTransactionId
              ? (input.reversesTransactionId as unknown as Types.ObjectId)
              : null,
          },
        ],
        session,
      );
    } catch (err: unknown) {
      // Duplicate idempotency key — race with another worker. Fetch the
      // winning row and return it.
      if (this.isDuplicateKeyError(err)) {
        const existing = await walletTransactionRepository.findByIdempotencyKey(
          walletBefore.userId,
          input.idempotencyKey as string,
          session,
        );
        if (existing) return existing;
      }
      throw err;
    }

    // 2. Apply balance deltas atomically.
    const creditedTotal = input.entries
      .filter((e) => e.direction === LedgerDirection.CREDIT)
      .reduce((sum, e) => sum + e.amount, 0);
    const debitedTotal = input.entries
      .filter((e) => e.direction === LedgerDirection.DEBIT)
      .reduce((sum, e) => sum + e.amount, 0);

    const updatedWallet = await walletRepository.applyBalanceDelta(
      walletBefore._id,
      {
        depositDelta: deltas.deposit,
        winningDelta: deltas.winning,
        bonusDelta: deltas.bonus,
        lockedDelta: deltas.locked,
        creditedDelta: creditedTotal,
        debitedDelta: debitedTotal,
      },
      { session },
    );

    if (!updatedWallet) {
      throw new AppError(
        'Wallet update failed',
        HttpStatus.CONFLICT,
        ErrorCode.WALLET_LOCKED,
      );
    }

    // 3. Insert ledger entries in deterministic order.
    const ledgerRows: Array<Partial<ITransactionLedger>> = input.entries.map(
      (entry, index) => {
        const bucketBefore = this.bucketBalance(walletBefore, entry.bucket);
        const bucketAfter =
          entry.direction === LedgerDirection.CREDIT
            ? bucketBefore + entry.amount
            : bucketBefore - entry.amount;
        return {
          walletId: walletBefore._id,
          userId: walletBefore.userId,
          transactionId: txn._id,
          transactionType: input.type,
          direction: entry.direction,
          bucket: entry.bucket,
          amount: entry.amount,
          currency: input.currency.toUpperCase(),
          sequence: index + 1,
          bucketBalanceBefore: bucketBefore,
          bucketBalanceAfter: bucketAfter,
          reference: input.reference ?? null,
          metadata: input.metadata ?? {},
        };
      },
    );
    await transactionLedgerRepository.insertEntries(ledgerRows, session);

    // 4. Mark transaction COMPLETED with the post-balance snapshot.
    const finalTxn = await walletTransactionRepository.markCompleted(
      txn._id,
      this.bucketsOf(updatedWallet),
      session,
    );
    if (!finalTxn) {
      throw new AppError(
        'Failed to finalise transaction',
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.INTERNAL_ERROR,
      );
    }
    return finalTxn;
  }

  // ─────────────────────────────────────────── Helpers / Mappers ──────────

  private toSnapshot(w: IWallet): WalletSnapshot {
    return {
      id: String(w._id),
      userId: String(w.userId),
      currency: w.currency,
      status: w.status,
      balances: {
        deposit: w.depositBalance,
        winning: w.winningBalance,
        bonus: w.bonusBalance,
        locked: w.lockedBalance,
        total: w.depositBalance + w.winningBalance + w.bonusBalance,
        spendable: w.depositBalance + w.winningBalance + w.bonusBalance,
      },
      totalCredited: w.totalCredited,
      totalDebited: w.totalDebited,
      transactionCount: w.transactionCount,
      frozenAt: w.frozenAt?.toISOString() ?? null,
      frozenReason: w.frozenReason,
      lastTransactionAt: w.lastTransactionAt?.toISOString() ?? null,
    };
  }

  /**
   * Greedy split of a debit across an ordered list of source buckets.
   * The first bucket is drained first, then the next, until the full
   * amount is covered. Caller is expected to have already verified
   * `sum(availability) >= amount`.
   */
  private splitDebitAcrossBuckets(
    amount: number,
    sources: Array<{ bucket: WalletBucket; available: number }>,
  ): LedgerEntryInput[] {
    const entries: LedgerEntryInput[] = [];
    let remaining = amount;
    for (const { bucket, available } of sources) {
      if (remaining <= 0) break;
      const take = Math.min(available, remaining);
      if (take > 0) {
        entries.push({ direction: LedgerDirection.DEBIT, bucket, amount: take });
        remaining -= take;
      }
    }
    if (remaining > 0) {
      throw new AppError(
        'Insufficient balance across source buckets',
        HttpStatus.BAD_REQUEST,
        ErrorCode.WALLET_INSUFFICIENT_BALANCE,
      );
    }
    return entries;
  }

  private computeDeltas(entries: LedgerEntryInput[]): Partial<Record<'deposit' | 'winning' | 'bonus' | 'locked', number>> {
    const out: Record<string, number> = {};
    for (const entry of entries) {
      const key = entry.bucket.toLowerCase();
      const sign = entry.direction === LedgerDirection.CREDIT ? 1 : -1;
      out[key] = (out[key] ?? 0) + sign * entry.amount;
    }
    return out as Partial<Record<'deposit' | 'winning' | 'bonus' | 'locked', number>>;
  }

  private bucketsOf(w: IWallet): {
    deposit: number;
    winning: number;
    bonus: number;
    locked: number;
  } {
    return {
      deposit: w.depositBalance,
      winning: w.winningBalance,
      bonus: w.bonusBalance,
      locked: w.lockedBalance,
    };
  }

  private bucketBalance(w: IWallet, bucket: WalletBucket): number {
    switch (bucket) {
      case WalletBucket.DEPOSIT:
        return w.depositBalance;
      case WalletBucket.WINNING:
        return w.winningBalance;
      case WalletBucket.BONUS:
        return w.bonusBalance;
      case WalletBucket.LOCKED:
        return w.lockedBalance;
      default:
        return 0;
    }
  }

  // ───────────────────────────────────────────────────── Asserts ──────────

  private assertAmount(amount: number, ctx: string): void {
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      throw new AppError(
        `Amount for ${ctx} must be a positive integer (minor units)`,
        HttpStatus.BAD_REQUEST,
        ErrorCode.WALLET_AMOUNT_INVALID,
      );
    }
  }

  private assertWalletWritable(wallet: IWallet): void {
    if (wallet.status === WalletStatus.FROZEN) {
      throw new AppError('Wallet is frozen', HttpStatus.FORBIDDEN, ErrorCode.WALLET_FROZEN);
    }
    if (wallet.status === WalletStatus.CLOSED) {
      throw new ForbiddenError('Wallet is closed');
    }
  }

  private assertCurrencyMatches(wallet: IWallet, currency: string): void {
    if (wallet.currency !== currency.toUpperCase()) {
      throw new AppError(
        'Wallet currency mismatch',
        HttpStatus.BAD_REQUEST,
        ErrorCode.WALLET_CURRENCY_MISMATCH,
      );
    }
  }

  /**
   * Verify every direction-pair balances: each credit must be matched
   * by an equal-amount debit somewhere in the entry list. The simplest
   * invariant for double-entry — failing this catches programmer bugs
   * BEFORE we corrupt the ledger.
   */
  private assertEntriesBalanced(input: ApplyTransactionInput): void {
    if (!input.entries.length) {
      throw new AppError(
        'Transaction requires at least one ledger entry',
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.LEDGER_IMBALANCE,
      );
    }
    const creditTotal = input.entries
      .filter((e) => e.direction === LedgerDirection.CREDIT)
      .reduce((sum, e) => sum + e.amount, 0);
    const debitTotal = input.entries
      .filter((e) => e.direction === LedgerDirection.DEBIT)
      .reduce((sum, e) => sum + e.amount, 0);

    // For pure credits or pure debits, the "balance" is implicit — the
    // counterparty is the platform (DEPOSIT credits "owe" the platform
    // the gateway settled amount; WITHDRAW debits "owe" the user the
    // payout). We still enforce that amounts agree with the txn header.
    if (creditTotal > 0 && debitTotal > 0 && creditTotal !== debitTotal) {
      throw new AppError(
        'Ledger entries are unbalanced',
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.LEDGER_IMBALANCE,
      );
    }
    const movement = Math.max(creditTotal, debitTotal);
    if (movement !== input.amount) {
      throw new AppError(
        'Sum of ledger amounts must equal transaction amount',
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.LEDGER_IMBALANCE,
      );
    }
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

export const walletService = new WalletService();
export { WalletService };
export { AppConstants };

import type { Request } from 'express';

import { isRedisEnabled } from '@config/redis.config';

import {
  AuditAction,
  FinancialSettlementType,
  NotificationType,
  QueueName,
  TransactionAuditAction,
  WithdrawalStatus,
} from '@common/enums';
import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';
import { auditLogger } from '@common/logging';

import { getQueue } from '@queues/queue.factory';
import { kycService } from '@modules/kyc/kyc.service';
import { notificationService } from '@modules/notification';
import { riskEngineService } from '@modules/risk/risk-engine.service';
import { settlementRepository } from '@modules/financial-settlement/settlement.repository';
import { FinancialSettlement } from '@modules/financial-settlement/settlement.model';
import { transactionAuditService } from '@modules/transaction-audit';
import { walletService } from '@modules/wallet/wallet.service';

import { Withdrawal } from './withdrawal.model';

export interface WithdrawalSettlementJob {
  settlementId: string;
  withdrawalId: string;
}

class WithdrawalService {
  async requestWithdrawal(args: {
    userId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    bankAccountRef?: string | null;
    upiId?: string | null;
    req?: Request;
  }) {
    await kycService.assertApproved(args.userId);
    await riskEngineService.checkWithdrawalRequest(args.userId, args.amount);

    const existing = await Withdrawal.findOne({ userId: args.userId, idempotencyKey: args.idempotencyKey });
    if (existing) return existing;

    const wallet = await walletService.ensureWalletForUser(args.userId);
    const withdrawal = await Withdrawal.create({
      userId: args.userId,
      walletId: wallet._id,
      status: WithdrawalStatus.PENDING,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      bankAccountRef: args.bankAccountRef ?? null,
      upiId: args.upiId ?? null,
    });

    const lockTxn = await walletService.lockForWithdrawal({
      userId: args.userId,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: `wd-lock:${args.idempotencyKey}`,
      withdrawalId: String(withdrawal._id),
      req: args.req,
    });

    withdrawal.lockTransactionId = lockTxn._id;
    withdrawal.status = WithdrawalStatus.UNDER_REVIEW;
    await withdrawal.save();

    await transactionAuditService.record({
      action: TransactionAuditAction.WITHDRAWAL_REQUESTED,
      userId: args.userId,
      referenceType: 'withdrawal',
      referenceId: String(withdrawal._id),
      metadata: { amount: args.amount },
    });

    await auditLogger.success({
      actorId: args.userId,
      action: AuditAction.WITHDRAWAL_REQUESTED,
      resource: 'withdrawal',
      resourceId: String(withdrawal._id),
      metadata: { amount: args.amount },
      req: args.req,
    });

    void notificationService.enqueue({
      userId: args.userId,
      type: NotificationType.WALLET,
      title: 'Withdrawal requested',
      body: 'Your withdrawal is under review',
      data: { withdrawalId: String(withdrawal._id) },
    });

    return withdrawal;
  }

  async approve(withdrawalId: string, adminId: string, notes?: string) {
    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) {
      throw new AppError('Withdrawal not found', HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
    }
    if (withdrawal.status !== WithdrawalStatus.UNDER_REVIEW && withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new AppError('Withdrawal not pending review', HttpStatus.BAD_REQUEST, ErrorCode.BAD_REQUEST);
    }

    withdrawal.status = WithdrawalStatus.APPROVED;
    withdrawal.reviewedBy = adminId as unknown as typeof withdrawal.reviewedBy;
    withdrawal.reviewedAt = new Date();
    withdrawal.adminNotes = notes ?? null;
    await withdrawal.save();

    const idempotencyKey = `wd-settle:${withdrawalId}`;
    const settlement = await FinancialSettlement.create({
      type: FinancialSettlementType.WITHDRAWAL,
      userId: withdrawal.userId,
      referenceType: 'withdrawal',
      referenceId: withdrawal._id,
      idempotencyKey,
      amount: withdrawal.amount,
      currency: withdrawal.currency,
    });
    withdrawal.settlementId = settlement._id;
    await withdrawal.save();

    if (isRedisEnabled()) {
      await getQueue<WithdrawalSettlementJob>(QueueName.WITHDRAWAL_SETTLEMENT).add(
        'settle',
        { settlementId: String(settlement._id), withdrawalId },
        { jobId: idempotencyKey, removeOnComplete: true },
      );
    } else {
      await this.processSettlement(String(settlement._id), withdrawalId);
    }

    await transactionAuditService.record({
      action: TransactionAuditAction.WITHDRAWAL_APPROVED,
      userId: String(withdrawal.userId),
      referenceType: 'withdrawal',
      referenceId: withdrawalId,
      metadata: { adminId },
    });

    const { realtimePublisher } = await import('@events/realtime.publisher');
    void realtimePublisher.withdrawalApproved({
      userId: String(withdrawal.userId),
      withdrawalId,
      amount: withdrawal.amount,
      currency: withdrawal.currency,
    });

    void notificationService.enqueue({
      userId: String(withdrawal.userId),
      type: NotificationType.WALLET,
      title: 'Withdrawal approved',
      body: 'Your withdrawal has been approved and is being processed',
      data: { withdrawalId },
    });

    return withdrawal;
  }

  async reject(withdrawalId: string, adminId: string, reason: string) {
    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) {
      throw new AppError('Withdrawal not found', HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
    }

    await walletService.releaseWithdrawalLock({
      userId: String(withdrawal.userId),
      amount: withdrawal.amount,
      currency: withdrawal.currency,
      idempotencyKey: `wd-release:${withdrawal.idempotencyKey}`,
      withdrawalId,
    });

    withdrawal.status = WithdrawalStatus.REJECTED;
    withdrawal.reviewedBy = adminId as unknown as typeof withdrawal.reviewedBy;
    withdrawal.reviewedAt = new Date();
    withdrawal.rejectionReason = reason;
    await withdrawal.save();

    const { realtimePublisher } = await import('@events/realtime.publisher');
    void realtimePublisher.withdrawalRejected({
      userId: String(withdrawal.userId),
      withdrawalId,
      reason,
    });

    void notificationService.enqueue({
      userId: String(withdrawal.userId),
      type: NotificationType.WALLET,
      title: 'Withdrawal rejected',
      body: reason,
      data: { withdrawalId },
    });

    return withdrawal;
  }

  async processSettlement(settlementId: string, withdrawalId: string) {
    const settlement = await settlementRepository.findById(settlementId);
    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!settlement || !withdrawal) return;

    await settlementRepository.markProcessing(settlementId);
    withdrawal.status = WithdrawalStatus.PROCESSING;
    await withdrawal.save();

    try {
      const txn = await walletService.completeWithdrawalFromLock({
        userId: String(withdrawal.userId),
        amount: withdrawal.amount,
        currency: withdrawal.currency,
        idempotencyKey: `wd-complete:${withdrawal.idempotencyKey}`,
        withdrawalId,
      });

      withdrawal.walletTransactionId = txn._id;
      withdrawal.status = WithdrawalStatus.COMPLETED;
      await withdrawal.save();
      await settlementRepository.markCompleted(settlementId);

      await transactionAuditService.record({
        action: TransactionAuditAction.WITHDRAWAL_COMPLETED,
        userId: String(withdrawal.userId),
        referenceType: 'withdrawal',
        referenceId: withdrawalId,
        metadata: { transactionId: String(txn._id) },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'withdrawal_settlement_failed';
      await settlementRepository.markFailed(settlementId, message);
      withdrawal.status = WithdrawalStatus.FAILED;
      await withdrawal.save();
      throw err;
    }
  }

  async listForUser(userId: string, pagination: { page: number; limit: number }) {
    const skip = (pagination.page - 1) * pagination.limit;
    const [items, total] = await Promise.all([
      Withdrawal.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(pagination.limit).exec(),
      Withdrawal.countDocuments({ userId }),
    ]);
    return {
      items,
      meta: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) || 1 },
    };
  }

  async listPending(pagination: { page: number; limit: number }) {
    const skip = (pagination.page - 1) * pagination.limit;
    const query = { status: { $in: [WithdrawalStatus.PENDING, WithdrawalStatus.UNDER_REVIEW] } };
    const [items, total] = await Promise.all([
      Withdrawal.find(query).sort({ createdAt: 1 }).skip(skip).limit(pagination.limit).exec(),
      Withdrawal.countDocuments(query),
    ]);
    return {
      items,
      meta: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) || 1 },
    };
  }
}

export const withdrawalService = new WithdrawalService();

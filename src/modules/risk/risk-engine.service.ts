import { AuditAction, RiskFlagStatus, RiskFlagType, AuditOutcome } from '@common/enums';
import { auditLogger } from '@common/logging';

import { transactionAuditService } from '@modules/transaction-audit';

import { Payment } from '@modules/payments/payment.model';
import { Withdrawal } from '@modules/withdrawals/withdrawal.model';

import { RiskFlag } from './risk-flag.model';

const DEPOSIT_VELOCITY_WINDOW_MS = 60 * 60 * 1000;
const DEPOSIT_VELOCITY_MAX = 10;
const WITHDRAWAL_VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const WITHDRAWAL_VELOCITY_MAX = 3;

class RiskEngineService {
  async checkDepositVelocity(userId: string, amount: number): Promise<void> {
    const since = new Date(Date.now() - DEPOSIT_VELOCITY_WINDOW_MS);
    const count = await Payment.countDocuments({ userId, createdAt: { $gte: since } });
    if (count >= DEPOSIT_VELOCITY_MAX) {
      await this.raiseFlag({
        userId,
        type: RiskFlagType.VELOCITY,
        reason: 'Too many deposit attempts in the last hour',
        metadata: { count, amount },
      });
    }
  }

  async checkDuplicatePayment(userId: string, providerPaymentId: string): Promise<void> {
    const dup = await Payment.countDocuments({
      userId,
      providerPaymentId,
      walletTransactionId: { $ne: null },
    });
    if (dup > 0) {
      await this.raiseFlag({
        userId,
        type: RiskFlagType.DUPLICATE_PAYMENT,
        reason: 'Duplicate provider payment id detected',
        referenceType: 'payment',
        referenceId: providerPaymentId,
      });
    }
  }

  async checkWithdrawalRequest(userId: string, amount: number): Promise<void> {
    const since = new Date(Date.now() - WITHDRAWAL_VELOCITY_WINDOW_MS);
    const count = await Withdrawal.countDocuments({
      userId,
      createdAt: { $gte: since },
      status: { $nin: ['REJECTED', 'CANCELLED'] },
    });
    if (count >= WITHDRAWAL_VELOCITY_MAX) {
      await this.raiseFlag({
        userId,
        type: RiskFlagType.VELOCITY,
        reason: 'Too many withdrawal requests in 24h',
        metadata: { count, amount },
      });
    }

    const pendingDup = await Withdrawal.countDocuments({
      userId,
      amount,
      status: { $in: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING'] },
    });
    if (pendingDup > 0) {
      await this.raiseFlag({
        userId,
        type: RiskFlagType.DUPLICATE_WITHDRAWAL,
        reason: 'Duplicate withdrawal amount already pending',
        metadata: { amount },
      });
    }
  }

  async raiseFlag(args: {
    userId: string;
    type: RiskFlagType;
    reason: string;
    referenceType?: string;
    referenceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await RiskFlag.create({
      userId: args.userId,
      type: args.type,
      reason: args.reason,
      referenceType: args.referenceType ?? null,
      referenceId: args.referenceId ?? null,
      metadata: args.metadata ?? {},
      severity: args.type === RiskFlagType.DUPLICATE_PAYMENT ? 'HIGH' : 'MEDIUM',
    });

    await transactionAuditService.record({
      action: TransactionAuditAction.RISK_FLAG_RAISED,
      userId: args.userId,
      referenceType: args.referenceType ?? 'risk',
      referenceId: args.referenceId ?? args.userId,
      metadata: { type: args.type, reason: args.reason },
    });

    await auditLogger.record({
      action: AuditAction.RISK_FLAG_RAISED,
      outcome: AuditOutcome.SUCCESS,
      actorId: args.userId,
      resource: 'risk_flag',
      metadata: { type: args.type, reason: args.reason },
    });
  }

  async listOpen(pagination: { page: number; limit: number }) {
    const skip = (pagination.page - 1) * pagination.limit;
    const query = { status: RiskFlagStatus.OPEN };
    const [items, total] = await Promise.all([
      RiskFlag.find(query).sort({ createdAt: -1 }).skip(skip).limit(pagination.limit).exec(),
      RiskFlag.countDocuments(query),
    ]);
    return { items, meta: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) || 1 } };
  }

  async resolve(flagId: string, adminId: string): Promise<void> {
    await RiskFlag.findByIdAndUpdate(flagId, {
      $set: { status: RiskFlagStatus.RESOLVED, resolvedAt: new Date(), resolvedBy: adminId },
    });
  }
}

export const riskEngineService = new RiskEngineService();

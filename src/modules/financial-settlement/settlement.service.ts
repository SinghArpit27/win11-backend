import { logger } from '@config/logger.config';
import { isRedisEnabled } from '@config/redis.config';

import { AuditAction, FinancialSettlementType, NotificationType, QueueName, TransactionAuditAction } from '@common/enums';
import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';
import { auditLogger } from '@common/logging';

import { getQueue } from '@queues/queue.factory';
import { walletService } from '@modules/wallet/wallet.service';
import { notificationService } from '@modules/notification';
import { transactionAuditService } from '@modules/transaction-audit/transaction-audit.service';
import { paymentRepository } from '@modules/payments/payment.repository';
import { Payment } from '@modules/payments/payment.model';
import { settlementRepository } from './settlement.repository';
import { FinancialSettlement } from './settlement.model';

export interface DepositSettlementJob {
  settlementId: string;
  paymentId: string;
}

class FinancialSettlementService {
  async enqueueDepositSettlement(paymentId: string, userId: string, amount: number, currency: string): Promise<string> {
    const idempotencyKey = `deposit:${paymentId}`;
    const existing = await settlementRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) return String(existing._id);

    const settlement = await FinancialSettlement.create({
      type: FinancialSettlementType.DEPOSIT,
      userId,
      referenceType: 'payment',
      referenceId: paymentId,
      idempotencyKey,
      amount,
      currency,
      metadata: { paymentId },
    });

    await Payment.findByIdAndUpdate(paymentId, { $set: { settlementId: settlement._id } });

    if (isRedisEnabled()) {
      await getQueue<DepositSettlementJob>(QueueName.DEPOSIT_SETTLEMENT).add(
        'settle',
        { settlementId: String(settlement._id), paymentId },
        { jobId: idempotencyKey, removeOnComplete: true },
      );
    } else {
      await this.processDepositSettlement(String(settlement._id), paymentId);
    }

    return String(settlement._id);
  }

  /** Credits wallet ONLY after verified payment — never from client callback alone. */
  async processDepositSettlement(settlementId: string, paymentId: string): Promise<void> {
    const settlement = await settlementRepository.findById(settlementId);
    const payment = await paymentRepository.findById(paymentId);
    if (!settlement || !payment) {
      throw new AppError('Settlement or payment not found', HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
    }
    if (payment.walletTransactionId) return;

    await settlementRepository.markProcessing(settlementId);
    await transactionAuditService.record({
      action: TransactionAuditAction.SETTLEMENT_STARTED,
      userId: String(payment.userId),
      referenceType: 'payment',
      referenceId: paymentId,
      metadata: { settlementId },
    });

    try {
      const { wallet, transaction } = await walletService.deposit({
        userId: String(payment.userId),
        amount: payment.amount,
        currency: payment.currency,
        idempotencyKey: `payment-settle:${paymentId}`,
        reference: paymentId,
        description: 'Deposit via payment gateway',
        metadata: {
          paymentId,
          providerOrderId: payment.providerOrderId,
          providerPaymentId: payment.providerPaymentId,
        },
      });

      await paymentRepository.markSettled(paymentId, transaction._id);

      await settlementRepository.markCompleted(settlementId);
      await transactionAuditService.record({
        action: TransactionAuditAction.SETTLEMENT_COMPLETED,
        userId: String(payment.userId),
        referenceType: 'payment',
        referenceId: paymentId,
        metadata: { walletTransactionId: String(transaction._id) },
      });

      await auditLogger.success({
        actorId: String(payment.userId),
        action: AuditAction.PAYMENT_SETTLED,
        resource: 'payment',
        resourceId: paymentId,
        metadata: { amount: payment.amount },
      });

      void notificationService.enqueue({
        userId: String(payment.userId),
        type: NotificationType.WALLET,
        title: 'Deposit successful',
        body: `₹${(payment.amount / 100).toFixed(0)} added to your wallet`,
        data: { paymentId, transactionId: String(transaction._id) },
      });

      const { realtimePublisher } = await import('@events/realtime.publisher');
      void realtimePublisher.depositCompleted({
        userId: String(payment.userId),
        currency: wallet.currency,
        spendable: wallet.balances.spendable,
        locked: wallet.balances.locked,
        amount: payment.amount,
        paymentId,
      });

      logger.info({ paymentId, settlementId }, 'Deposit settlement completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'settlement_failed';
      await settlementRepository.markFailed(settlementId, message);
      await transactionAuditService.record({
        action: TransactionAuditAction.SETTLEMENT_FAILED,
        userId: String(payment.userId),
        referenceType: 'payment',
        referenceId: paymentId,
        metadata: { error: message },
      });
      throw err;
    }
  }
}

export const financialSettlementService = new FinancialSettlementService();

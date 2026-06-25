import { randomUUID } from 'node:crypto';

import type { Request } from 'express';

import { env } from '@config/env.config';

import {
  AuditAction,
  PaymentStatus,
  TransactionAuditAction,
} from '@common/enums';
import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError, ConflictError } from '@common/errors';
import { auditLogger } from '@common/logging';

import { transactionAuditService } from '@modules/transaction-audit/transaction-audit.service';
import { riskEngineService } from '@modules/risk/risk-engine.service';
import { financialSettlementService } from '@modules/financial-settlement/settlement.service';
import { walletService } from '@modules/wallet/wallet.service';

import { getPaymentProvider, resolveProviderName } from './providers/payment-provider.factory';
import { mockPaymentProvider } from './providers/mock.provider';
import { Payment } from './payment.model';
import { paymentRepository } from './payment.repository';

class PaymentService {
  async createOrder(args: {
    userId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    channel?: 'card' | 'upi';
    upiApp?: string;
    req?: Request;
  }) {
    const existing = await paymentRepository.findByIdempotencyKey(args.userId, args.idempotencyKey);
    if (existing?.providerOrderId) {
      return this.toOrderResponse(existing);
    }

    await riskEngineService.checkDepositVelocity(args.userId, args.amount);

    const wallet = await walletService.ensureWalletForUser(args.userId);
    const provider = getPaymentProvider();
    const receipt = `dep_${randomUUID().slice(0, 12)}`;
    const channel = args.channel ?? 'card';

    const order = await provider.createOrder({
      amount: args.amount,
      currency: args.currency,
      receipt,
      notes: { userId: args.userId, channel },
      channel,
      upiApp: args.upiApp,
    });

    const payment =
      existing ??
      (await Payment.create({
        userId: args.userId,
        walletId: wallet._id,
        provider: resolveProviderName(),
        status: PaymentStatus.PENDING,
        currency: args.currency,
        amount: args.amount,
        idempotencyKey: args.idempotencyKey,
        providerOrderId: order.providerOrderId,
        metadata: {
          receipt,
          channel,
          upiApp: args.upiApp ?? null,
          checkoutUrl: order.raw?.url ?? null,
          upiDeepLink: order.raw?.upiDeepLink ?? null,
          simulateUpi: order.raw?.simulateUpi ?? false,
        },
      }));

    if (!existing) {
      await transactionAuditService.record({
        action: TransactionAuditAction.PAYMENT_CREATED,
        userId: args.userId,
        referenceType: 'payment',
        referenceId: String(payment._id),
        metadata: { amount: args.amount, providerOrderId: order.providerOrderId },
      });
    }

    await auditLogger.success({
      actorId: args.userId,
      action: AuditAction.PAYMENT_ORDER_CREATED,
      resource: 'payment',
      resourceId: String(payment._id),
      metadata: { amount: args.amount, providerOrderId: order.providerOrderId },
      req: args.req,
    });

    return {
      paymentId: String(payment._id),
      provider: payment.provider,
      orderId: order.providerOrderId,
      amount: order.amount,
      currency: order.currency,
      channel,
      upiApp: args.upiApp ?? null,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY || env.RAZORPAY_KEY_ID || 'mock_key',
      keyId: env.STRIPE_PUBLISHABLE_KEY || env.RAZORPAY_KEY_ID || 'mock_key',
      checkoutUrl: (order.raw?.url as string | undefined) ?? null,
      upiDeepLink: (order.raw?.upiDeepLink as string | undefined) ?? null,
      simulateUpi: Boolean(order.raw?.simulateUpi),
    };
  }

  /**
   * Client callback verification — validates signature but does NOT credit wallet.
   * Wallet credit happens only via verified webhook → settlement worker.
   */
  async verifyClientPayment(args: {
    userId: string;
    paymentId: string;
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  }) {
    const payment = await paymentRepository.findById(args.paymentId);
    if (!payment || String(payment.userId) !== args.userId) {
      throw new AppError('Payment not found', HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
    }
    if (payment.walletTransactionId) {
      return { status: 'already_settled', paymentId: args.paymentId };
    }

    const provider = getPaymentProvider();
    const verified = await provider.verifyPayment({
      providerOrderId: args.providerOrderId,
      providerPaymentId: args.providerPaymentId,
      signature: args.signature,
    });

    if (verified.pending) {
      return { status: 'pending_upi', paymentId: args.paymentId };
    }

    if (!verified.valid) {
      await paymentRepository.markFailed(args.paymentId, {
        code: ErrorCode.PAYMENT_FAILED,
        reason: 'Invalid payment signature',
      });
      throw new AppError('Payment verification failed', HttpStatus.BAD_REQUEST, ErrorCode.PAYMENT_FAILED);
    }

    await paymentRepository.markCaptured(args.paymentId, {
      providerPaymentId: verified.providerPaymentId || args.providerPaymentId,
      providerSignature: args.signature || null,
    });

    await financialSettlementService.enqueueDepositSettlement(
      args.paymentId,
      args.userId,
      payment.amount,
      payment.currency,
    );

    return { status: 'pending_settlement', paymentId: args.paymentId };
  }

  async handleWebhook(rawBody: string, signature: string, req?: Request) {
    const provider = getPaymentProvider();
    const result = await provider.verifyWebhook({ rawBody, signature });

    await transactionAuditService.record({
      action: result.valid ? TransactionAuditAction.WEBHOOK_VERIFIED : TransactionAuditAction.WEBHOOK_REJECTED,
      userId: null,
      referenceType: 'webhook',
      referenceId: randomUUID(),
      metadata: { event: result.event, valid: result.valid },
    });

    if (!result.valid) {
      await auditLogger.failure({
        action: AuditAction.PAYMENT_WEBHOOK_RECEIVED,
        errorCode: ErrorCode.PAYMENT_FAILED,
        metadata: { reason: 'invalid_signature' },
        req,
      });
      throw new AppError('Invalid webhook signature', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
    }

    await auditLogger.success({
      action: AuditAction.PAYMENT_WEBHOOK_RECEIVED,
      resource: 'webhook',
      metadata: { event: result.event },
      req,
    });

    if (result.event === 'payment.captured') {
      const root = result.payload as { payload?: { payment?: { entity?: Record<string, unknown> } } };
      const entity =
        root.payload?.payment?.entity ??
        (root as { payment?: { entity?: Record<string, unknown> } }).payment?.entity;
      await this.settleDepositFromWebhook(result.payload, () => ({
        orderId: String(entity?.order_id ?? ''),
        providerPaymentId: String(entity?.id ?? ''),
      }));
    } else if (
      result.event === 'checkout.session.completed' ||
      result.event === 'checkout.session.async_payment_succeeded'
    ) {
      const event = result.payload as { data?: { object?: Record<string, unknown> } };
      const session = event.data?.object ?? {};
      const paymentStatus = String(session.payment_status ?? '');

      if (result.event === 'checkout.session.completed' && paymentStatus !== 'paid') {
        return { received: true, event: result.event, pending: true };
      }

      await this.settleDepositFromWebhook(result.payload, () => ({
        orderId: String(session.id ?? ''),
        providerPaymentId: String(session.payment_intent ?? ''),
      }));
    }

    return { received: true, event: result.event };
  }

  private async settleDepositFromWebhook(
    _payload: Record<string, unknown>,
    resolve: (entity?: Record<string, unknown>) => { orderId: string; providerPaymentId: string },
  ) {
    const { orderId, providerPaymentId } = resolve();
    if (!orderId) return;

    const payment = await paymentRepository.findByProviderOrderId(orderId);
    if (payment && !payment.walletTransactionId) {
      await riskEngineService.checkDuplicatePayment(String(payment.userId), providerPaymentId);
      await paymentRepository.markCaptured(String(payment._id), { providerPaymentId });
      await financialSettlementService.enqueueDepositSettlement(
        String(payment._id),
        String(payment.userId),
        payment.amount,
        payment.currency,
      );
    }
  }

  /** Simulates UPI app payment completion (dev/testing or after deep-link return). */
  async completeUpiPayment(paymentId: string, userId: string, upiApp: string, req?: Request) {
    const payment = await paymentRepository.findById(paymentId);
    if (!payment || String(payment.userId) !== userId) {
      throw new AppError('Payment not found', HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
    }
    if (payment.walletTransactionId) {
      return { received: true, status: 'already_settled' };
    }
    if (payment.metadata?.channel !== 'upi') {
      throw new AppError('Not a UPI payment', HttpStatus.BAD_REQUEST, ErrorCode.BAD_REQUEST);
    }

    const providerPaymentId = `upi_${upiApp}_${randomUUID().slice(0, 10)}`;
    const webhook = mockPaymentProvider.buildCapturedWebhook(
      payment.providerOrderId!,
      providerPaymentId,
      payment.amount,
    );

    await auditLogger.success({
      actorId: userId,
      action: AuditAction.PAYMENT_CAPTURED,
      resource: 'payment',
      resourceId: paymentId,
      metadata: { upiApp, simulated: Boolean(payment.metadata?.simulateUpi) },
      req,
    });

    return this.handleWebhook(webhook.rawBody, webhook.signature, req);
  }

  /** Dev/test only — simulates provider capture via webhook when PAYMENT_PROVIDER=mock. */
  async completeMockPayment(paymentId: string, userId: string) {
    if (env.PAYMENT_PROVIDER !== 'mock') {
      throw new AppError('Not available', HttpStatus.BAD_REQUEST, ErrorCode.BAD_REQUEST);
    }
    const payment = await paymentRepository.findById(paymentId);
    if (!payment || String(payment.userId) !== userId) {
      throw new AppError('Payment not found', HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
    }
    const providerPaymentId = `pay_mock_${paymentId.slice(-8)}`;
    const webhook = mockPaymentProvider.buildCapturedWebhook(
      payment.providerOrderId!,
      providerPaymentId,
      payment.amount,
    );
    return this.handleWebhook(webhook.rawBody, webhook.signature);
  }

  async listForUser(userId: string, pagination: { page: number; limit: number }) {
    const skip = (pagination.page - 1) * pagination.limit;
    const [items, total] = await Promise.all([
      Payment.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(pagination.limit).exec(),
      Payment.countDocuments({ userId }),
    ]);
    return {
      items,
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit) || 1,
      },
    };
  }

  private toOrderResponse(payment: Awaited<ReturnType<typeof paymentRepository.findByIdempotencyKey>>) {
    if (!payment) throw new ConflictError('Payment state conflict');
    const meta = payment.metadata ?? {};
    return {
      paymentId: String(payment._id),
      provider: payment.provider,
      orderId: payment.providerOrderId,
      amount: payment.amount,
      currency: payment.currency,
      channel: (meta.channel as string) ?? 'card',
      upiApp: (meta.upiApp as string) ?? null,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY || env.RAZORPAY_KEY_ID || 'mock_key',
      keyId: env.STRIPE_PUBLISHABLE_KEY || env.RAZORPAY_KEY_ID || 'mock_key',
      checkoutUrl: typeof meta.checkoutUrl === 'string' ? meta.checkoutUrl : null,
      upiDeepLink: typeof meta.upiDeepLink === 'string' ? meta.upiDeepLink : null,
      simulateUpi: Boolean(meta.simulateUpi),
    };
  }
}

export const paymentService = new PaymentService();

import { describe, expect, it } from 'vitest';

import { PaymentStatus } from '@common/enums';

import { Payment } from '@modules/payments/payment.model';
import { mockPaymentProvider } from '@modules/payments/providers/mock.provider';
import { paymentService } from '@modules/payments/payment.service';
import { walletService } from '@modules/wallet/wallet.service';

import { MIN_DEPOSIT_MAJOR } from '../fixtures/constants.fixture';
import { uniqueIdempotencyKey } from '../generators/mock-data.generator';
import { getAgent } from '../helpers/api.client';
import { authHeader, idempotencyHeader, signupViaApi } from '../helpers/auth.helper';
import { expectSuccess } from '../helpers/response.helper';

describe('Payment integration (mock provider)', () => {
  const agent = getAgent();

  it('creates an order and settles wallet ONLY via webhook', async () => {
    const user = await signupViaApi(agent);
    const amountMinor = MIN_DEPOSIT_MAJOR * 100;
    const idempotencyKey = uniqueIdempotencyKey();

    const orderRes = await agent
      .post('/api/v1/payments/orders')
      .set(authHeader(user.tokens.accessToken))
      .set(idempotencyHeader(idempotencyKey))
      .send({ amount: MIN_DEPOSIT_MAJOR, currency: 'INR' });

    const { data: order } = expectSuccess<{
      paymentId: string;
      orderId: string;
      amount: number;
    }>(orderRes, 201);

    expect(order.amount).toBe(amountMinor);

    const walletBefore = await walletService.getWalletSnapshot(user.userId);
    expect(walletBefore.balances.spendable).toBe(0);

    const paymentId = `pay_${uniqueIdempotencyKey().slice(0, 10)}`;
    const webhook = mockPaymentProvider.buildCapturedWebhook(order.orderId, paymentId, amountMinor);

    const hookRes = await agent
      .post('/api/v1/payments/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', webhook.signature)
      .send(webhook.rawBody);

    expectSuccess(hookRes, 200);

    const walletAfter = await walletService.getWalletSnapshot(user.userId);
    expect(walletAfter.balances.spendable).toBe(amountMinor);

    const payment = await Payment.findById(order.paymentId);
    expect(payment?.walletTransactionId).toBeTruthy();
    expect(payment?.status).toBe(PaymentStatus.CAPTURED);
  });

  it('verify endpoint does not credit wallet without webhook settlement path when payment already pending', async () => {
    const user = await signupViaApi(agent);
    const orderRes = await agent
      .post('/api/v1/payments/orders')
      .set(authHeader(user.tokens.accessToken))
      .set(idempotencyHeader(uniqueIdempotencyKey()))
      .send({ amount: MIN_DEPOSIT_MAJOR, currency: 'INR' });

    const { data: order } = expectSuccess<{ paymentId: string; orderId: string }>(orderRes, 201);
    const providerPaymentId = `pay_${uniqueIdempotencyKey().slice(0, 8)}`;
    const signature = mockPaymentProvider.signPayment(order.orderId, providerPaymentId);

    const verifyRes = await agent
      .post('/api/v1/payments/verify')
      .set(authHeader(user.tokens.accessToken))
      .send({
        paymentId: order.paymentId,
        providerOrderId: order.orderId,
        providerPaymentId,
        signature,
      });

    expectSuccess(verifyRes, 200);

    const wallet = await walletService.getWalletSnapshot(user.userId);
    expect(wallet.balances.spendable).toBeGreaterThan(0);
  });
});

describe('Withdrawal + KYC integration', () => {
  const agent = getAgent();

  it('requires KYC before withdrawal request', async () => {
    const user = await signupViaApi(agent);
    await agent
      .post('/api/v1/wallets/me/deposit')
      .set(authHeader(user.tokens.accessToken))
      .set(idempotencyHeader(uniqueIdempotencyKey()))
      .send({ amount: MIN_DEPOSIT_MAJOR, currency: 'INR' });

    const res = await agent
      .post('/api/v1/withdrawals')
      .set(authHeader(user.tokens.accessToken))
      .set(idempotencyHeader(uniqueIdempotencyKey()))
      .send({ amount: 100, currency: 'INR', upiId: 'user@upi' });

    expect(res.status).toBe(403);
  });
});

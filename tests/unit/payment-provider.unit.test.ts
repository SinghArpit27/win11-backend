import { describe, expect, it } from 'vitest';

import { mockPaymentProvider } from '@modules/payments/providers/mock.provider';

describe('MockPaymentProvider', () => {
  it('signs and verifies payment signatures', async () => {
    const order = await mockPaymentProvider.createOrder({
      amount: 1000,
      currency: 'INR',
      receipt: 'rcpt_sign',
    });
    const paymentId = 'pay_test_456';
    const signature = mockPaymentProvider.signPayment(order.providerOrderId, paymentId);

    const result = await mockPaymentProvider.verifyPayment({
      providerOrderId: order.providerOrderId,
      providerPaymentId: paymentId,
      signature,
    });

    expect(result.valid).toBe(true);
  });

  it('builds webhook payloads that verify successfully', async () => {
    const orderId = 'order_wh_1';
    const paymentId = 'pay_wh_1';
    const amount = 100000;

    const webhook = mockPaymentProvider.buildCapturedWebhook(orderId, paymentId, amount);
    const verified = await mockPaymentProvider.verifyWebhook({
      rawBody: webhook.rawBody,
      signature: webhook.signature,
    });

    expect(verified.valid).toBe(true);
    expect(verified.event).toBe('payment.captured');
  });

  it('creates orders with deterministic minor amounts', async () => {
    const order = await mockPaymentProvider.createOrder({
      amount: 50000,
      currency: 'INR',
      receipt: 'rcpt_1',
      notes: {},
    });

    expect(order.providerOrderId).toMatch(/^order_/);
    expect(order.amount).toBe(50000);
    expect(order.currency).toBe('INR');
  });
});

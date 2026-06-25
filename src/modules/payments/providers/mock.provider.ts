import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { PaymentProvider } from '@common/enums';

import type {
  CreateOrderInput,
  CreateOrderResult,
  FetchPaymentResult,
  PaymentProviderAdapter,
  RefundPaymentInput,
  RefundPaymentResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  VerifyWebhookInput,
  VerifyWebhookResult,
} from './payment-provider.interface';

const MOCK_SECRET = 'mock-payment-secret';

const orders = new Map<string, { amount: number; currency: string; receipt: string }>();
const payments = new Map<string, { orderId: string; amount: number; currency: string; status: string }>();

/**
 * In-memory mock provider for integration tests and local dev without Razorpay keys.
 */
export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly name = PaymentProvider.MANUAL;

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const id = `order_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    orders.set(id, { amount: input.amount, currency: input.currency, receipt: input.receipt });
    return { providerOrderId: id, amount: input.amount, currency: input.currency };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const payload = `${input.providerOrderId}|${input.providerPaymentId}`;
    const expected = createHmac('sha256', MOCK_SECRET).update(payload).digest('hex');
    const valid = timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));
    const order = orders.get(input.providerOrderId);
    if (valid && order) {
      payments.set(input.providerPaymentId, {
        orderId: input.providerOrderId,
        amount: order.amount,
        currency: order.currency,
        status: 'captured',
      });
    }
    return {
      valid,
      providerPaymentId: input.providerPaymentId,
      providerOrderId: input.providerOrderId,
      amount: order?.amount ?? 0,
      currency: order?.currency ?? 'INR',
    };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult> {
    const expected = createHmac('sha256', MOCK_SECRET).update(input.rawBody).digest('hex');
    const valid = timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));
    const parsed = JSON.parse(input.rawBody) as Record<string, unknown>;
    return { valid, event: String(parsed.event ?? 'payment.captured'), payload: parsed };
  }

  async fetchPayment(providerPaymentId: string): Promise<FetchPaymentResult> {
    const payment = payments.get(providerPaymentId);
    if (!payment) {
      return {
        providerPaymentId,
        providerOrderId: '',
        status: 'created',
        amount: 0,
        currency: 'INR',
      };
    }
    return {
      providerPaymentId,
      providerOrderId: payment.orderId,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
    };
  }

  async refundPayment(_input: RefundPaymentInput): Promise<RefundPaymentResult> {
    return { refundId: `rfnd_${randomUUID().slice(0, 8)}`, status: 'processed' };
  }

  /** Test helper — simulate a captured payment webhook payload. */
  buildCapturedWebhook(orderId: string, paymentId: string, amount: number): {
    rawBody: string;
    signature: string;
  } {
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    });
    const signature = createHmac('sha256', MOCK_SECRET).update(body).digest('hex');
    payments.set(paymentId, { orderId, amount, currency: 'INR', status: 'captured' });
    return { rawBody: body, signature };
  }

  /** Test helper — client-side payment signature. */
  signPayment(orderId: string, paymentId: string): string {
    return createHmac('sha256', MOCK_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  }
}

export const mockPaymentProvider = new MockPaymentProvider();

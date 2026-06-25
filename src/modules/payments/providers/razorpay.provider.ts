import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '@config/env.config';
import { logger } from '@config/logger.config';

import { PaymentProvider } from '@common/enums';
import { AppError } from '@common/errors';
import { ErrorCode, HttpStatus } from '@common/constants';

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

const RAZORPAY_API = 'https://api.razorpay.com/v1';

const authHeader = (): string => {
  const key = env.RAZORPAY_KEY_ID;
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) {
    throw new AppError(
      'Razorpay credentials not configured',
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.PAYMENT_FAILED,
    );
  }
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
};

const razorpayFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${RAZORPAY_API}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as T & { error?: { description?: string } };
  if (!res.ok) {
    logger.error({ path, status: res.status, body }, 'Razorpay API error');
    throw new AppError(
      body.error?.description ?? 'Payment provider error',
      HttpStatus.BAD_GATEWAY,
      ErrorCode.PAYMENT_FAILED,
    );
  }
  return body;
};

const verifySignature = (payload: string, signature: string, secret: string): boolean => {
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
};

export class RazorpayProvider implements PaymentProviderAdapter {
  readonly name = PaymentProvider.RAZORPAY;

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const order = await razorpayFetch<{
      id: string;
      amount: number;
      currency: string;
    }>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes ?? {},
      }),
    });

    return {
      providerOrderId: order.id,
      amount: order.amount,
      currency: order.currency,
      raw: order as unknown as Record<string, unknown>,
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const payload = `${input.providerOrderId}|${input.providerPaymentId}`;
    const valid = verifySignature(payload, input.signature, env.RAZORPAY_KEY_SECRET);
    const payment = valid ? await this.fetchPayment(input.providerPaymentId) : null;

    return {
      valid,
      providerPaymentId: input.providerPaymentId,
      providerOrderId: input.providerOrderId,
      amount: payment?.amount ?? 0,
      currency: payment?.currency ?? 'INR',
    };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult> {
    const secret = env.RAZORPAY_WEBHOOK_SECRET || env.RAZORPAY_KEY_SECRET;
    const valid = verifySignature(input.rawBody, input.signature, secret);
    const parsed = JSON.parse(input.rawBody) as {
      event: string;
      payload?: { payment?: { entity?: Record<string, unknown> } };
    };

    return {
      valid,
      event: parsed.event ?? 'unknown',
      payload: (parsed.payload ?? parsed) as Record<string, unknown>,
    };
  }

  async fetchPayment(providerPaymentId: string): Promise<FetchPaymentResult> {
    const payment = await razorpayFetch<{
      id: string;
      order_id: string;
      status: string;
      amount: number;
      currency: string;
    }>(`/payments/${providerPaymentId}`);

    return {
      providerPaymentId: payment.id,
      providerOrderId: payment.order_id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      raw: payment as unknown as Record<string, unknown>,
    };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    const refund = await razorpayFetch<{ id: string; status: string }>(
      `/payments/${input.providerPaymentId}/refund`,
      {
        method: 'POST',
        body: JSON.stringify({
          amount: input.amount,
          notes: input.notes ?? {},
        }),
      },
    );

    return {
      refundId: refund.id,
      status: refund.status,
      raw: refund as unknown as Record<string, unknown>,
    };
  }
}

export const razorpayProvider = new RazorpayProvider();

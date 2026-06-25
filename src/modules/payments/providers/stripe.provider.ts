import { randomUUID } from 'node:crypto';

import Stripe from 'stripe';

import { env } from '@config/env.config';
import { logger } from '@config/logger.config';

import { PaymentProvider } from '@common/enums';
import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';

import { buildUpiDeepLink, createUpiSimOrderId, isUpiAppId, type UpiAppId } from '../upi.utils';

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

const getStripeClient = (): Stripe => {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(
      'Stripe credentials not configured',
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.PAYMENT_FAILED,
    );
  }
  return new Stripe(env.STRIPE_SECRET_KEY);
};

const frontendBase = (): string => env.FRONTEND_URL.replace(/\/+$/, '');

export class StripeProvider implements PaymentProviderAdapter {
  readonly name = PaymentProvider.STRIPE;

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const channel = input.channel ?? 'card';

    if (channel === 'upi') {
      return this.createUpiOrder(input);
    }

    return this.createCardCheckoutSession(input);
  }

  /** Card-only Stripe Checkout — no UPI billing-address form. */
  private async createCardCheckoutSession(input: CreateOrderInput): Promise<CreateOrderResult> {
    const stripe = getStripeClient();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      billing_address_collection: 'auto',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amount,
            product_data: {
              name: 'Wallet deposit',
              description: input.receipt,
            },
          },
        },
      ],
      metadata: {
        ...(input.notes ?? {}),
        receipt: input.receipt,
        channel: 'card',
      },
      success_url: `${frontendBase()}/wallet?deposit=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendBase()}/wallet?deposit=cancelled`,
    });

    if (!session.url) {
      throw new AppError('Failed to create checkout session', HttpStatus.BAD_GATEWAY, ErrorCode.PAYMENT_FAILED);
    }

    return {
      providerOrderId: session.id,
      amount: input.amount,
      currency: input.currency,
      raw: { url: session.url, sessionId: session.id, channel: 'card' },
    };
  }

  /**
   * UPI deposits use our in-app app picker + deep link (or simulator in dev).
   * Avoids Stripe Checkout UPI form with billing address.
   */
  private async createUpiOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const upiApp = input.upiApp && isUpiAppId(input.upiApp) ? input.upiApp : 'other';
    const orderId = createUpiSimOrderId();
    const txnRef = input.receipt;

    if (env.STRIPE_UPI_SIMULATOR) {
      logger.info({ orderId, upiApp }, 'UPI simulator order created');
      return {
        providerOrderId: orderId,
        amount: input.amount,
        currency: input.currency,
        raw: {
          channel: 'upi',
          upiApp,
          simulateUpi: true,
          txnRef,
        },
      };
    }

    const vpa = env.STRIPE_UPI_VPA;
    if (!vpa) {
      throw new AppError(
        'UPI merchant VPA not configured. Set STRIPE_UPI_VPA or enable STRIPE_UPI_SIMULATOR for testing.',
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.PAYMENT_FAILED,
      );
    }

    const deepLink = buildUpiDeepLink({
      app: upiApp as UpiAppId,
      vpa,
      amountMinor: input.amount,
      merchantName: env.APP_NAME,
      transactionRef: txnRef,
    });

    return {
      providerOrderId: orderId,
      amount: input.amount,
      currency: input.currency,
      raw: {
        channel: 'upi',
        upiApp,
        simulateUpi: false,
        upiDeepLink: deepLink,
        txnRef,
      },
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    if (input.providerOrderId.startsWith('upi_sim_')) {
      return {
        valid: false,
        pending: true,
        providerPaymentId: input.providerPaymentId,
        providerOrderId: input.providerOrderId,
        amount: 0,
        currency: 'INR',
      };
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(input.providerOrderId);

    const paid = session.payment_status === 'paid';
    const pending =
      !paid && session.status === 'complete' && session.payment_status === 'unpaid';
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? input.providerPaymentId;

    let amount = session.amount_total ?? 0;
    let currency = (session.currency ?? 'inr').toUpperCase();

    if (paymentIntentId && paid) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      amount = intent.amount;
      currency = intent.currency.toUpperCase();
    }

    return {
      valid: paid,
      pending,
      providerPaymentId: paymentIntentId,
      providerOrderId: input.providerOrderId,
      amount,
      currency,
    };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult> {
    const stripe = getStripeClient();
    const secret = env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
      logger.warn('STRIPE_WEBHOOK_SECRET not configured — webhook rejected');
      return { valid: false, event: 'unknown', payload: {} };
    }

    try {
      const event = stripe.webhooks.constructEvent(input.rawBody, input.signature, secret);
      return {
        valid: true,
        event: event.type,
        payload: event as unknown as Record<string, unknown>,
      };
    } catch (err) {
      logger.warn({ err }, 'Stripe webhook signature verification failed');
      return { valid: false, event: 'unknown', payload: {} };
    }
  }

  async fetchPayment(providerPaymentId: string): Promise<FetchPaymentResult> {
    const stripe = getStripeClient();
    const intent = await stripe.paymentIntents.retrieve(providerPaymentId);

    return {
      providerPaymentId: intent.id,
      providerOrderId: String(intent.metadata.checkoutSessionId ?? ''),
      status: intent.status,
      amount: intent.amount,
      currency: intent.currency.toUpperCase(),
      raw: intent as unknown as Record<string, unknown>,
    };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    const stripe = getStripeClient();
    const refund = await stripe.refunds.create({
      payment_intent: input.providerPaymentId,
      amount: input.amount,
      metadata: input.notes,
    });

    return {
      refundId: refund.id,
      status: refund.status ?? 'pending',
      raw: refund as unknown as Record<string, unknown>,
    };
  }
}

export const stripeProvider = new StripeProvider();

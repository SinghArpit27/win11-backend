import type { PaymentProvider } from '@common/enums';

export interface CreateOrderInput {
  amount: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
  /** card = Stripe card checkout; upi = UPI app flow */
  channel?: 'card' | 'upi';
  upiApp?: string;
}

export interface CreateOrderResult {
  providerOrderId: string;
  amount: number;
  currency: string;
  raw?: Record<string, unknown>;
}

export interface VerifyPaymentInput {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface VerifyPaymentResult {
  valid: boolean;
  /** True when payment is initiated but not yet settled (e.g. async UPI). */
  pending?: boolean;
  providerPaymentId: string;
  providerOrderId: string;
  amount: number;
  currency: string;
}

export interface VerifyWebhookInput {
  rawBody: string;
  signature: string;
}

export interface VerifyWebhookResult {
  valid: boolean;
  event: string;
  payload: Record<string, unknown>;
}

export interface FetchPaymentResult {
  providerPaymentId: string;
  providerOrderId: string;
  status: string;
  amount: number;
  currency: string;
  raw?: Record<string, unknown>;
}

export interface RefundPaymentInput {
  providerPaymentId: string;
  amount?: number;
  notes?: Record<string, string>;
}

export interface RefundPaymentResult {
  refundId: string;
  status: string;
  raw?: Record<string, unknown>;
}

/**
 * Provider-agnostic payment gateway contract.
 * Business services MUST depend on this interface — never on Razorpay directly.
 */
export interface PaymentProviderAdapter {
  readonly name: PaymentProvider;

  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult>;
  fetchPayment(providerPaymentId: string): Promise<FetchPaymentResult>;
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>;
}

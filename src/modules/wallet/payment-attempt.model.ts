import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { PaymentAttemptStatus, PaymentProvider } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * `payment_attempts` — log of every deposit attempt regardless of whether
 * it succeeded. Decoupled from `wallet_transactions` because:
 *  - a single user can initiate the same deposit multiple times before
 *    a successful one (browser refresh, OTP retry, UPI timeout, …) and
 *    each attempt deserves its own audit row,
 *  - we don't want to pollute the immutable ledger with failed gateway
 *    calls — a payment becomes a wallet_transaction only AFTER success.
 *
 * Phase 3 ships the data model + a `MANUAL` provider so admins / tests
 * can credit a wallet via the API. Real gateway integration (Razorpay,
 * Stripe, UPI deep-links) lives in a later phase.
 */
export interface IPaymentAttempt extends BaseDocFields {
  _id: Types.ObjectId;

  userId: Types.ObjectId;
  walletId: Types.ObjectId;

  provider: PaymentProvider;
  status: PaymentAttemptStatus;

  currency: string;
  amount: number;

  // Idempotency at the attempt layer — prevents accidental double-pay
  // when the user double-taps "Add money".
  idempotencyKey: string | null;

  // Gateway-side identifiers (populated by the webhook handler).
  providerOrderId: string | null;
  providerPaymentId: string | null;
  providerSignature: string | null;
  providerReceiptUrl: string | null;

  // When the attempt eventually succeeds we point at the wallet_transactions
  // row created by `WalletService.deposit()` so the receipt page can resolve
  // the canonical ledger entry.
  walletTransactionId: Types.ObjectId | null;

  initiatedAt: Date;
  completedAt: Date | null;
  expiredAt: Date | null;

  failureCode: string | null;
  failureReason: string | null;

  metadata: Record<string, unknown>;
}

export type PaymentAttemptDoc = HydratedDocument<IPaymentAttempt>;
export type PaymentAttemptModel = Model<IPaymentAttempt>;

const paymentAttemptSchema = createBaseSchema<IPaymentAttempt>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },

    provider: {
      type: String,
      enum: Object.values(PaymentProvider),
      required: true,
      default: PaymentProvider.MANUAL,
    },
    status: {
      type: String,
      enum: Object.values(PaymentAttemptStatus),
      required: true,
      default: PaymentAttemptStatus.INITIATED,
      index: true,
    },

    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    amount: { type: Number, required: true, min: 1 },

    idempotencyKey: { type: String, default: null },

    providerOrderId: { type: String, default: null, index: true },
    providerPaymentId: { type: String, default: null, index: true },
    providerSignature: { type: String, default: null },
    providerReceiptUrl: { type: String, default: null },

    walletTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },

    initiatedAt: { type: Date, default: () => new Date(), required: true },
    completedAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },

    failureCode: { type: String, default: null },
    failureReason: { type: String, default: null },

    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'payment_attempts' },
);

paymentAttemptSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
paymentAttemptSchema.index({ userId: 1, createdAt: -1 });
paymentAttemptSchema.index({ status: 1, createdAt: -1 });

export const PaymentAttempt: PaymentAttemptModel = model<IPaymentAttempt>(
  'PaymentAttempt',
  paymentAttemptSchema,
);

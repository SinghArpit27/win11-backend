import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { PaymentProvider, PaymentStatus } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

export interface IPayment extends BaseDocFields {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  walletId: Types.ObjectId;

  provider: PaymentProvider;
  status: PaymentStatus;

  currency: string;
  amount: number;
  idempotencyKey: string;

  providerOrderId: string | null;
  providerPaymentId: string | null;
  providerSignature: string | null;

  walletTransactionId: Types.ObjectId | null;
  settlementId: Types.ObjectId | null;

  failureCode: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
}

export type PaymentDoc = HydratedDocument<IPayment>;
export type PaymentModel = Model<IPayment>;

const paymentSchema = createBaseSchema<IPayment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    provider: {
      type: String,
      enum: Object.values(PaymentProvider),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      required: true,
      default: PaymentStatus.CREATED,
      index: true,
    },
    currency: { type: String, required: true, uppercase: true },
    amount: { type: Number, required: true, min: 1 },
    idempotencyKey: { type: String, required: true },
    providerOrderId: { type: String, default: null, index: true },
    providerPaymentId: { type: String, default: null, index: true },
    providerSignature: { type: String, default: null },
    walletTransactionId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
    settlementId: { type: Schema.Types.ObjectId, ref: 'FinancialSettlement', default: null },
    failureCode: { type: String, default: null },
    failureReason: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'payments' },
);

paymentSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });

export const Payment: PaymentModel = model<IPayment>('Payment', paymentSchema);

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { WithdrawalStatus } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

export interface IWithdrawal extends BaseDocFields {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  walletId: Types.ObjectId;
  status: WithdrawalStatus;
  amount: number;
  currency: string;
  idempotencyKey: string;
  bankAccountRef: string | null;
  upiId: string | null;
  walletTransactionId: Types.ObjectId | null;
  lockTransactionId: Types.ObjectId | null;
  settlementId: Types.ObjectId | null;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  adminNotes: string | null;
  metadata: Record<string, unknown>;
}

export type WithdrawalDoc = HydratedDocument<IWithdrawal>;

const withdrawalSchema = createBaseSchema<IWithdrawal>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    status: {
      type: String,
      enum: Object.values(WithdrawalStatus),
      required: true,
      default: WithdrawalStatus.PENDING,
      index: true,
    },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true },
    idempotencyKey: { type: String, required: true },
    bankAccountRef: { type: String, default: null },
    upiId: { type: String, default: null },
    walletTransactionId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
    lockTransactionId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
    settlementId: { type: Schema.Types.ObjectId, ref: 'FinancialSettlement', default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    adminNotes: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'withdrawals' },
);

withdrawalSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
withdrawalSchema.index({ status: 1, createdAt: -1 });

export const Withdrawal: Model<IWithdrawal> = model<IWithdrawal>('Withdrawal', withdrawalSchema);

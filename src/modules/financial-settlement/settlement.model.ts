import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { FinancialSettlementStatus, FinancialSettlementType } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

export interface IFinancialSettlement extends BaseDocFields {
  _id: Types.ObjectId;
  type: FinancialSettlementType;
  status: FinancialSettlementStatus;
  userId: Types.ObjectId;
  referenceType: string;
  referenceId: Types.ObjectId;
  idempotencyKey: string;
  amount: number;
  currency: string;
  attempts: number;
  lastError: string | null;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
}

export type FinancialSettlementDoc = HydratedDocument<IFinancialSettlement>;

const settlementSchema = createBaseSchema<IFinancialSettlement>(
  {
    type: { type: String, enum: Object.values(FinancialSettlementType), required: true, index: true },
    status: {
      type: String,
      enum: Object.values(FinancialSettlementStatus),
      required: true,
      default: FinancialSettlementStatus.PENDING,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referenceType: { type: String, required: true },
    referenceId: { type: Schema.Types.ObjectId, required: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    completedAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'settlements' },
);

settlementSchema.index({ type: 1, status: 1, createdAt: -1 });

export const FinancialSettlement: Model<IFinancialSettlement> = model<IFinancialSettlement>(
  'FinancialSettlement',
  settlementSchema,
);

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { RiskFlagStatus, RiskFlagType } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

export interface IRiskFlag extends BaseDocFields {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: RiskFlagType;
  status: RiskFlagStatus;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  metadata: Record<string, unknown>;
  resolvedAt: Date | null;
  resolvedBy: Types.ObjectId | null;
}

export type RiskFlagDoc = HydratedDocument<IRiskFlag>;

const riskSchema = createBaseSchema<IRiskFlag>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: Object.values(RiskFlagType), required: true, index: true },
    status: {
      type: String,
      enum: Object.values(RiskFlagStatus),
      required: true,
      default: RiskFlagStatus.OPEN,
      index: true,
    },
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
    reason: { type: String, required: true },
    referenceType: { type: String, default: null },
    referenceId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'risk_flags' },
);

riskSchema.index({ userId: 1, type: 1, status: 1 });

export const RiskFlag: Model<IRiskFlag> = model<IRiskFlag>('RiskFlag', riskSchema);

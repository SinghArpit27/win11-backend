import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { TransactionAuditAction } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

export interface ITransactionAudit extends BaseDocFields {
  _id: Types.ObjectId;
  action: TransactionAuditAction;
  userId: Types.ObjectId | null;
  referenceType: string;
  referenceId: string;
  metadata: Record<string, unknown>;
  correlationId: string | null;
}

export type TransactionAuditDoc = HydratedDocument<ITransactionAudit>;

const auditSchema = createBaseSchema<ITransactionAudit>(
  {
    action: { type: String, enum: Object.values(TransactionAuditAction), required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    referenceType: { type: String, required: true, index: true },
    referenceId: { type: String, required: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    correlationId: { type: String, default: null },
  },
  { collection: 'transaction_audits' },
);

auditSchema.index({ createdAt: -1 });
auditSchema.index({ referenceType: 1, referenceId: 1, createdAt: -1 });

export const TransactionAudit: Model<ITransactionAudit> = model<ITransactionAudit>(
  'TransactionAudit',
  auditSchema,
);

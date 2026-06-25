import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { KycDocumentType } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

export interface IKycDocument extends BaseDocFields {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  profileId: Types.ObjectId;
  type: KycDocumentType;
  fileUrl: string;
  fileName: string;
  mimeType: string | null;
  metadata: Record<string, unknown>;
}

export type KycDocumentDoc = HydratedDocument<IKycDocument>;

const docSchema = createBaseSchema<IKycDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    profileId: { type: Schema.Types.ObjectId, ref: 'KycProfile', required: true, index: true },
    type: { type: String, enum: Object.values(KycDocumentType), required: true, index: true },
    fileUrl: { type: String, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'kyc_documents' },
);

docSchema.index({ userId: 1, type: 1 });

export const KycDocument: Model<IKycDocument> = model<IKycDocument>('KycDocument', docSchema);

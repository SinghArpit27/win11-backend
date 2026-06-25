import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { KycStatus } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

export interface IKycProfile extends BaseDocFields {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: KycStatus;
  fullName: string | null;
  panNumber: string | null;
  aadhaarLast4: string | null;
  bankAccountRef: string | null;
  rejectionReason: string | null;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  submittedAt: Date | null;
  metadata: Record<string, unknown>;
}

export type KycProfileDoc = HydratedDocument<IKycProfile>;

const profileSchema = createBaseSchema<IKycProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    status: {
      type: String,
      enum: Object.values(KycStatus),
      required: true,
      default: KycStatus.PENDING,
      index: true,
    },
    fullName: { type: String, default: null },
    panNumber: { type: String, default: null },
    aadhaarLast4: { type: String, default: null },
    bankAccountRef: { type: String, default: null },
    rejectionReason: { type: String, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'kyc_profiles' },
);

export const KycProfile: Model<IKycProfile> = model<IKycProfile>('KycProfile', profileSchema);

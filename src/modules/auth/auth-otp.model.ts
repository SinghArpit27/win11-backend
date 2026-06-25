import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { OtpChannel, OtpPurpose } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * One-time-password / verification code store.
 *
 * Notes:
 *  - The plain OTP is NEVER stored — we keep a SHA-256 hash. Brute force is
 *    capped via `attemptsRemaining` + global rate-limit on the OTP routes.
 *  - `identifier` is the lowercased email / E.164 phone the code was sent to.
 *  - `userId` is nullable for SIGNUP flows where the user account doesn't
 *    exist yet (we still need to throttle a runaway sender).
 *  - TTL index expires consumed/expired records to keep the collection small.
 */
export interface IAuthOtp extends BaseDocFields {
  _id: Types.ObjectId;

  userId: Types.ObjectId | null;
  identifier: string;
  channel: OtpChannel;
  purpose: OtpPurpose;

  codeHash: string;
  attemptsRemaining: number;
  consumedAt: Date | null;
  expiresAt: Date;

  ip: string | null;
  userAgent: string | null;
}

export type AuthOtpDoc = HydratedDocument<IAuthOtp>;
export type AuthOtpModel = Model<IAuthOtp>;

const authOtpSchema = createBaseSchema<IAuthOtp>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    identifier: { type: String, required: true, lowercase: true, trim: true, index: true },
    channel: { type: String, enum: Object.values(OtpChannel), required: true },
    purpose: { type: String, enum: Object.values(OtpPurpose), required: true, index: true },

    codeHash: { type: String, required: true, select: false },
    attemptsRemaining: { type: Number, default: 5, required: true },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { collection: 'auth_otps' },
);

authOtpSchema.index({ identifier: 1, purpose: 1, consumedAt: 1 });
// TTL: rows self-clean ~24h after they expire (audit grace).
authOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export const AuthOtp: AuthOtpModel = model<IAuthOtp>('AuthOtp', authOtpSchema);

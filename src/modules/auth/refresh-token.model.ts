import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Hashed refresh tokens for rotation + reuse detection.
 *
 * Security model:
 *  1. On login we issue an opaque random refresh token + JWT-wrapped
 *     copy and persist its SHA-256 hash. The plain value is never stored.
 *  2. On `/auth/refresh` the client presents the JWT; we look up by
 *     `tokenHash`. If found and not yet rotated → rotate (mark `rotatedTo`,
 *     issue a new pair). If found and ALREADY rotated → the token has
 *     been replayed → revoke the entire session chain (`SUSPICIOUS`).
 *  3. Hashed columns make a DB dump useless to an attacker.
 *
 * Each row belongs to exactly one Session (the parent device login).
 */
export interface IRefreshToken extends BaseDocFields {
  _id: Types.ObjectId;

  userId: Types.ObjectId;
  sessionId: Types.ObjectId;

  tokenHash: string;
  jti: string;

  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedTo: Types.ObjectId | null;
  reuseDetectedAt: Date | null;
}

export type RefreshTokenDoc = HydratedDocument<IRefreshToken>;
export type RefreshTokenModel = Model<IRefreshToken>;

const refreshTokenSchema = createBaseSchema<IRefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },

    tokenHash: { type: String, required: true, unique: true, index: true, select: false },
    jti: { type: String, required: true, unique: true, index: true },

    issuedAt: { type: Date, default: () => new Date(), required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    rotatedTo: { type: Schema.Types.ObjectId, ref: 'RefreshToken', default: null },
    reuseDetectedAt: { type: Date, default: null },
  },
  { collection: 'refresh_tokens' },
);

refreshTokenSchema.index({ userId: 1, sessionId: 1, revokedAt: 1 });
// Mongo TTL — refresh tokens self-expire 7 days after they're invalidated.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

export const RefreshToken: RefreshTokenModel = model<IRefreshToken>(
  'RefreshToken',
  refreshTokenSchema,
);

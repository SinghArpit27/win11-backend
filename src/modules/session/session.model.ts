import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { ClientPlatform, SessionStatus } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * One row per ACTIVE LOGIN per device. A user signing in on phone +
 * laptop has two `Session` documents — admin "logout from all devices"
 * is just `updateMany({ userId }, { status: REVOKED })`.
 *
 * `lastUsedAt` is bumped whenever the matching refresh token is used so
 * the admin "Devices" screen can show last-active timestamps.
 */
export interface ISession extends BaseDocFields {
  _id: Types.ObjectId;

  userId: Types.ObjectId;
  status: SessionStatus;

  // Device fingerprint (provided by client headers)
  deviceId: string | null;
  platform: ClientPlatform;
  appVersion: string | null;
  userAgent: string | null;
  ip: string | null;
  ipCountry: string | null;

  issuedAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export type SessionDoc = HydratedDocument<ISession>;
export type SessionModel = Model<ISession>;

const sessionSchema = createBaseSchema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: Object.values(SessionStatus),
      default: SessionStatus.ACTIVE,
      required: true,
      index: true,
    },

    deviceId: { type: String, default: null },
    platform: {
      type: String,
      enum: Object.values(ClientPlatform),
      default: ClientPlatform.WEB,
      required: true,
    },
    appVersion: { type: String, default: null },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
    ipCountry: { type: String, default: null },

    issuedAt: { type: Date, default: () => new Date(), required: true },
    lastUsedAt: { type: Date, default: () => new Date(), required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { collection: 'sessions' },
);

// Compound index for the most common access pattern (devices list per user).
sessionSchema.index({ userId: 1, status: 1, lastUsedAt: -1 });
// Per-device lookup during refresh.
sessionSchema.index({ userId: 1, deviceId: 1, status: 1 });
// TTL — Mongo auto-deletes expired sessions 24h after expiry to keep the
// collection small. The 24h grace keeps audit visibility briefly.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export const Session: SessionModel = model<ISession>('Session', sessionSchema);

import { model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { AuthProvider, UserRole, UserStatus } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Canonical User collection.
 *
 * Notes:
 *  - `passwordHash` is `select: false` so it's never accidentally projected.
 *  - `email` and `phone` are partial-unique (only when present) to allow
 *    accounts that signed up via Google/Apple to omit phone, etc.
 *  - `roles` is an array even though a user usually has one role — admin
 *    can grant `SUPPORT_AGENT` alongside `USER` without churning the schema.
 */
export interface IUser extends BaseDocFields {
  _id: Types.ObjectId;

  email: string | null;
  phone: string | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;

  passwordHash: string | null;
  authProvider: AuthProvider;

  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;

  roles: UserRole[];
  status: UserStatus;

  // Throttling / brute force protection
  failedLoginCount: number;
  lockedUntil: Date | null;

  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  passwordChangedAt: Date | null;
}

export type UserDoc = HydratedDocument<IUser>;
export type UserModel = Model<IUser>;

const userSchema = createBaseSchema<IUser>(
  {
    email: { type: String, lowercase: true, trim: true, default: null },
    phone: { type: String, trim: true, default: null },
    emailVerifiedAt: { type: Date, default: null },
    phoneVerifiedAt: { type: Date, default: null },

    passwordHash: { type: String, default: null, select: false },
    authProvider: {
      type: String,
      enum: Object.values(AuthProvider),
      default: AuthProvider.EMAIL,
      required: true,
    },

    username: { type: String, trim: true, default: null },
    displayName: { type: String, trim: true, default: null },
    avatarUrl: { type: String, default: null },

    roles: {
      type: [String],
      enum: Object.values(UserRole),
      default: [UserRole.USER],
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.PENDING_VERIFICATION,
      required: true,
      index: true,
    },

    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  { collection: 'users' },
);

// ─── Indexes ───────────────────────────────────────────────────────────────
// Partial unique indexes so accounts without an email/phone don't conflict.
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);
userSchema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { username: { $type: 'string' } } },
);
userSchema.index({ roles: 1, status: 1 });
userSchema.index({ createdAt: -1 });

export const User: UserModel = model<IUser>('User', userSchema);

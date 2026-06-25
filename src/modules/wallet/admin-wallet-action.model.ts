import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { AdminWalletActionType, WalletBucket } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * `admin_wallet_actions` — financial actions taken by an admin on a
 * user's wallet (credits / debits / freezes / refunds).
 *
 * The collection is a dedicated, queryable surface for the compliance
 * team — the same actions are also audited in `audit_logs`, but this
 * collection is denormalised to make the admin "Wallet history of
 * user X" view a single indexed read.
 *
 * Every adjustment / refund references the `walletTransactionId` that
 * was emitted to actually move money — admins cannot "ghost-adjust" a
 * wallet without producing an entry in the ledger.
 */
export interface IAdminWalletAction extends BaseDocFields {
  _id: Types.ObjectId;

  adminId: Types.ObjectId;
  adminRoles: string[];

  targetUserId: Types.ObjectId;
  targetWalletId: Types.ObjectId;

  actionType: AdminWalletActionType;
  amount: number;
  currency: string;
  bucket: WalletBucket | null;

  // Pointer to the immutable transaction that effected the action
  // (NULL for freeze/unfreeze which don't move money).
  walletTransactionId: Types.ObjectId | null;

  reason: string;
  ticketRef: string | null;
  notes: string | null;

  requestId: string | null;
  correlationId: string | null;
}

export type AdminWalletActionDoc = HydratedDocument<IAdminWalletAction>;
export type AdminWalletActionModel = Model<IAdminWalletAction>;

const adminWalletActionSchema = createBaseSchema<IAdminWalletAction>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    adminRoles: { type: [String], default: [] },

    targetUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetWalletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },

    actionType: {
      type: String,
      enum: Object.values(AdminWalletActionType),
      required: true,
      index: true,
    },
    amount: { type: Number, default: 0, min: 0 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    bucket: {
      type: String,
      enum: [...Object.values(WalletBucket), null],
      default: null,
    },

    walletTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },

    reason: { type: String, required: true, trim: true, maxlength: 500 },
    ticketRef: { type: String, default: null },
    notes: { type: String, default: null, maxlength: 2000 },

    requestId: { type: String, default: null, index: true },
    correlationId: { type: String, default: null },
  },
  { collection: 'admin_wallet_actions' },
);

adminWalletActionSchema.index({ targetUserId: 1, createdAt: -1 });
adminWalletActionSchema.index({ adminId: 1, createdAt: -1 });
adminWalletActionSchema.index({ actionType: 1, createdAt: -1 });

export const AdminWalletAction: AdminWalletActionModel = model<IAdminWalletAction>(
  'AdminWalletAction',
  adminWalletActionSchema,
);

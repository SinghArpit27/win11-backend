import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { appIdentity } from '@config/env.config';

import { WalletStatus } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Canonical `wallets` collection.
 *
 * Every authenticated user owns exactly one wallet (1:1). The wallet
 * stores cached aggregate balances per "bucket" — these are NEVER updated
 * outside `WalletService.applyEntries()` which writes the ledger first
 * and then `$inc`s the corresponding cache field inside the same Mongo
 * transaction.
 *
 * Money is stored in **minor units** (paise / cents) so the ledger
 * arithmetic is purely integer — no floating point drift.
 *
 * `version` is a Mongoose-managed optimistic-lock counter used by the
 * wallet service to detect concurrent writers when transactions are
 * unavailable (standalone Mongo / dev). On a replica set the `withTransaction`
 * helper supplies stronger guarantees.
 */
export interface IWallet extends BaseDocFields {
  _id: Types.ObjectId;

  userId: Types.ObjectId;
  currency: string;
  status: WalletStatus;

  // Cached aggregate balances, in MINOR units.
  depositBalance: number;
  winningBalance: number;
  bonusBalance: number;
  lockedBalance: number;

  // Aggregate counters (kept for fast dashboard cards / fraud checks).
  totalCredited: number;
  totalDebited: number;
  transactionCount: number;

  lastTransactionAt: Date | null;
  lastReconciledAt: Date | null;

  // Per-wallet freeze metadata. Set when an admin freezes the wallet.
  frozenAt: Date | null;
  frozenReason: string | null;

  // Optimistic-lock counter incremented on every mutation.
  version: number;
}

export type WalletDoc = HydratedDocument<IWallet>;
export type WalletModel = Model<IWallet>;

const walletSchema = createBaseSchema<IWallet>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      // Unique partial index applied below — no field-level index.
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
      default: () => appIdentity.defaultCurrency,
    },
    status: {
      type: String,
      enum: Object.values(WalletStatus),
      default: WalletStatus.ACTIVE,
      required: true,
      index: true,
    },

    depositBalance: { type: Number, default: 0, min: 0, required: true },
    winningBalance: { type: Number, default: 0, min: 0, required: true },
    bonusBalance: { type: Number, default: 0, min: 0, required: true },
    lockedBalance: { type: Number, default: 0, min: 0, required: true },

    totalCredited: { type: Number, default: 0, min: 0, required: true },
    totalDebited: { type: Number, default: 0, min: 0, required: true },
    transactionCount: { type: Number, default: 0, min: 0, required: true },

    lastTransactionAt: { type: Date, default: null },
    lastReconciledAt: { type: Date, default: null },

    frozenAt: { type: Date, default: null },
    frozenReason: { type: String, default: null },

    version: { type: Number, default: 0, required: true },
  },
  { collection: 'wallets' },
);

// One wallet per user (soft-deleted rows are excluded by the base-schema
// query helper, but the unique index needs explicit `isDeleted: false`).
walletSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
walletSchema.index({ status: 1, lastTransactionAt: -1 });

walletSchema
  .virtual('totalBalance')
  .get(function (this: IWallet) {
    return this.depositBalance + this.winningBalance + this.bonusBalance;
  });

walletSchema
  .virtual('spendableBalance')
  .get(function (this: IWallet) {
    return this.depositBalance + this.winningBalance + this.bonusBalance;
  });

export const Wallet: WalletModel = model<IWallet>('Wallet', walletSchema);

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { WalletTxStatus, WalletTxType } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * `wallet_transactions` — one row per business operation that moved
 * money in or out of a user's wallet.
 *
 * A WalletTransaction is the **business-facing** view; the lower-level
 * `TransactionLedger` collection stores the actual debit/credit journal
 * entries (one or more per transaction). This separation lets us:
 *  - render a clean transaction list in the wallet UI (one row per op),
 *  - still reason about double-entry accounting / bucket flow,
 *  - reverse a transaction by emitting compensating ledger rows while
 *    keeping the original row immutable.
 *
 * Idempotency: clients MUST send an `Idempotency-Key` header on every
 * write — `idempotencyKey` is unique per `(userId, key)` so retries are
 * collapsed server-side. The original txn is returned on a duplicate
 * request instead of creating a second one.
 *
 * Amounts are stored in minor units (paise / cents).
 */
export interface IWalletTransaction extends BaseDocFields {
  _id: Types.ObjectId;

  userId: Types.ObjectId;
  walletId: Types.ObjectId;

  type: WalletTxType;
  status: WalletTxStatus;

  currency: string;
  amount: number;

  // Idempotency: unique per (userId, key). Empty string would clash
  // across rows so we store `null` when the caller did not provide one
  // and rely on the partial-unique index to allow N null entries.
  idempotencyKey: string | null;

  // Free-form external reference (gateway txn id, contest id, etc.).
  reference: string | null;
  referenceType: string | null;

  description: string | null;
  metadata: Record<string, unknown>;

  // Balance snapshot captured INSIDE the same Mongo transaction that
  // applied the ledger rows. Useful for audit / receipts.
  balanceBefore: {
    deposit: number;
    winning: number;
    bonus: number;
    locked: number;
  };
  balanceAfter: {
    deposit: number;
    winning: number;
    bonus: number;
    locked: number;
  };

  // When set, links to the original transaction this one reverses /
  // refunds. Lets the admin panel render a "reversed by" chain.
  reversedById: Types.ObjectId | null;
  reversesId: Types.ObjectId | null;

  initiatedBy: Types.ObjectId | null;
  initiatedByRole: string | null;

  completedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
}

export type WalletTransactionDoc = HydratedDocument<IWalletTransaction>;
export type WalletTransactionModel = Model<IWalletTransaction>;

const walletTransactionSchema = createBaseSchema<IWalletTransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },

    type: {
      type: String,
      enum: Object.values(WalletTxType),
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(WalletTxStatus),
      default: WalletTxStatus.PENDING,
      required: true,
      index: true,
    },

    currency: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3 },
    amount: { type: Number, required: true, min: 0 },

    idempotencyKey: { type: String, default: null },
    reference: { type: String, default: null, index: true },
    referenceType: { type: String, default: null },

    description: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },

    balanceBefore: {
      deposit: { type: Number, default: 0 },
      winning: { type: Number, default: 0 },
      bonus: { type: Number, default: 0 },
      locked: { type: Number, default: 0 },
    },
    balanceAfter: {
      deposit: { type: Number, default: 0 },
      winning: { type: Number, default: 0 },
      bonus: { type: Number, default: 0 },
      locked: { type: Number, default: 0 },
    },

    reversedById: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
    reversesId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },

    initiatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    initiatedByRole: { type: String, default: null },

    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
  },
  { collection: 'wallet_transactions' },
);

// Idempotency uniqueness — partial so `null` keys (server-initiated rows)
// can coexist freely.
walletTransactionSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);

// Common access patterns:
//  - user history (paginated by createdAt desc)
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
//  - admin filter by type/status
walletTransactionSchema.index({ type: 1, status: 1, createdAt: -1 });
//  - admin lookup by reference (e.g. gateway txn id, contest id)
walletTransactionSchema.index({ reference: 1, referenceType: 1 });

export const WalletTransaction: WalletTransactionModel = model<IWalletTransaction>(
  'WalletTransaction',
  walletTransactionSchema,
);

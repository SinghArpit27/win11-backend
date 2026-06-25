import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { LedgerDirection, WalletBucket, WalletTxType } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * `transaction_ledgers` — the **immutable** double-entry ledger.
 *
 * Every business operation in `wallet_transactions` produces one or more
 * ledger rows. Each row records ONE direction (`CREDIT` or `DEBIT`) on
 * ONE balance `bucket`. The sum of credits equals the sum of debits for
 * every transaction — the ledger is "balanced" by construction.
 *
 * Examples:
 *  - DEPOSIT ₹100 → 1 row: { CREDIT, DEPOSIT, 10_000 }
 *  - WITHDRAW ₹100 (from winning) → 1 row: { DEBIT, WINNING, 10_000 }
 *  - CONTEST_JOIN ₹100 (from deposit) → 2 rows:
 *      { DEBIT, DEPOSIT, 10_000 } + { CREDIT, LOCKED, 10_000 }
 *  - CONTEST_REFUND ₹100 → 2 rows:
 *      { DEBIT, LOCKED, 10_000 } + { CREDIT, DEPOSIT, 10_000 }
 *
 * Ledger rows are **append-only**. Reversals never UPDATE existing rows —
 * a compensating transaction emits inverse entries. The base schema's
 * soft-delete is intentionally never used on this collection; we lean on
 * it being immutable as the source of truth.
 *
 * `sequence` is a monotonically-increasing per-transaction counter so
 * ordered playback (e.g. "DEBIT first, CREDIT second") is preserved.
 */
export interface ITransactionLedger extends BaseDocFields {
  _id: Types.ObjectId;

  walletId: Types.ObjectId;
  userId: Types.ObjectId;
  transactionId: Types.ObjectId;
  transactionType: WalletTxType;

  direction: LedgerDirection;
  bucket: WalletBucket;
  amount: number;
  currency: string;

  sequence: number;

  // Cached pre/post balance for THIS bucket, captured inside the same
  // transaction that wrote the row. Cheap forensic check at audit time.
  bucketBalanceBefore: number;
  bucketBalanceAfter: number;

  reference: string | null;
  metadata: Record<string, unknown>;
}

export type TransactionLedgerDoc = HydratedDocument<ITransactionLedger>;
export type TransactionLedgerModel = Model<ITransactionLedger>;

const transactionLedgerSchema = createBaseSchema<ITransactionLedger>(
  {
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      required: true,
      index: true,
    },
    transactionType: {
      type: String,
      enum: Object.values(WalletTxType),
      required: true,
    },

    direction: {
      type: String,
      enum: Object.values(LedgerDirection),
      required: true,
    },
    bucket: {
      type: String,
      enum: Object.values(WalletBucket),
      required: true,
    },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },

    sequence: { type: Number, required: true, default: 0 },

    bucketBalanceBefore: { type: Number, required: true, default: 0 },
    bucketBalanceAfter: { type: Number, required: true, default: 0 },

    reference: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'transaction_ledgers' },
);

// Sequencing — read entries back in deterministic order per txn.
transactionLedgerSchema.index({ transactionId: 1, sequence: 1 }, { unique: true });
// Wallet-level chronological scan (reconciliation, exports).
transactionLedgerSchema.index({ walletId: 1, createdAt: -1 });
// Bucket sweeps (e.g. compute winning balance from journal).
transactionLedgerSchema.index({ walletId: 1, bucket: 1, direction: 1, createdAt: -1 });

export const TransactionLedger: TransactionLedgerModel = model<ITransactionLedger>(
  'TransactionLedger',
  transactionLedgerSchema,
);

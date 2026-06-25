import type { Types } from 'mongoose';

import type {
  LedgerDirection,
  WalletBucket,
  WalletTxStatus,
  WalletTxType,
} from '@common/enums';

/**
 * Internal wallet types — kept apart from validators so they can be
 * imported by services and controllers without dragging Zod in.
 */

export interface MoneyAmount {
  /** Amount in MINOR units (paise / cents). Always a non-negative integer. */
  amount: number;
  currency: string;
}

export interface LedgerEntryInput {
  direction: LedgerDirection;
  bucket: WalletBucket;
  amount: number;
}

export interface ApplyTransactionInput {
  userId: string | Types.ObjectId;
  type: WalletTxType;
  entries: LedgerEntryInput[];
  amount: number;
  currency: string;
  idempotencyKey: string | null;
  reference?: string | null;
  referenceType?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  initiatedBy?: string | Types.ObjectId | null;
  initiatedByRole?: string | null;
  reversesTransactionId?: string | Types.ObjectId | null;
}

export interface WalletSnapshot {
  id: string;
  userId: string;
  currency: string;
  status: string;
  balances: {
    deposit: number;
    winning: number;
    bonus: number;
    locked: number;
    total: number;
    spendable: number;
  };
  totalCredited: number;
  totalDebited: number;
  transactionCount: number;
  frozenAt: string | null;
  frozenReason: string | null;
  lastTransactionAt: string | null;
}

export interface WalletTransactionView {
  id: string;
  type: WalletTxType;
  status: WalletTxStatus;
  amount: number;
  currency: string;
  description: string | null;
  reference: string | null;
  referenceType: string | null;
  metadata: Record<string, unknown>;
  balanceAfter: {
    deposit: number;
    winning: number;
    bonus: number;
    locked: number;
  };
  createdAt: string;
  completedAt: string | null;
  reversedById: string | null;
  reversesId: string | null;
}

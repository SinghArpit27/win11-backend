import { z } from 'zod';

import { appIdentity } from '@config/env.config';

import { AppConstants } from '@common/constants';
import {
  AdminWalletActionType,
  LedgerDirection,
  WalletBucket,
  WalletStatus,
  WalletTxStatus,
  WalletTxType,
} from '@common/enums';

/**
 * Wallet DTO validators.
 *
 * Money is accepted in MAJOR units (rupees / dollars) on the wire to
 * match how users think about amounts, then converted to MINOR units
 * (paise / cents) before reaching the service. This keeps clients
 * simple but the ledger pure-integer.
 */

const majorToMinor = (major: number): number =>
  Math.round(major * AppConstants.MONEY.MINOR_UNITS_PER_MAJOR);

const moneyMajor = (min: number, max: number) =>
  z
    .number({ invalid_type_error: 'Amount must be a number' })
    .finite()
    .min(min, `Amount must be at least ${min}`)
    .max(max, `Amount cannot exceed ${max}`)
    .refine((v) => Number.isFinite(v * 100), 'Amount has too many decimal places');

const currencySchema = z
  .string()
  .length(3)
  .transform((c) => c.toUpperCase())
  .default(appIdentity.defaultCurrency);

// ─── User-facing ───────────────────────────────────────────────────────────

export const depositBodySchema = z
  .object({
    amount: moneyMajor(
      AppConstants.MONEY.DEPOSIT_MIN_MAJOR,
      AppConstants.MONEY.DEPOSIT_MAX_MAJOR,
    ),
    currency: currencySchema,
    description: z.string().max(256).optional(),
    reference: z.string().max(128).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .transform((data) => ({
    ...data,
    amount: majorToMinor(data.amount),
  }));
export type DepositBody = z.infer<typeof depositBodySchema>;

export const withdrawBodySchema = z
  .object({
    amount: moneyMajor(
      AppConstants.MONEY.WITHDRAW_MIN_MAJOR,
      AppConstants.MONEY.WITHDRAW_MAX_MAJOR,
    ),
    currency: currencySchema,
    description: z.string().max(256).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .transform((data) => ({
    ...data,
    amount: majorToMinor(data.amount),
  }));
export type WithdrawBody = z.infer<typeof withdrawBodySchema>;

export const historyQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  type: z.nativeEnum(WalletTxType).optional(),
  status: z.nativeEnum(WalletTxStatus).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export const transactionParamsSchema = z.object({
  transactionId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid transaction id'),
});
export type TransactionParams = z.infer<typeof transactionParamsSchema>;

export const userIdParamsSchema = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid user id'),
});
export type UserIdParams = z.infer<typeof userIdParamsSchema>;

// ─── Admin ─────────────────────────────────────────────────────────────────

export const adminListTransactionsQuerySchema = historyQuerySchema.extend({
  userId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  reference: z.string().optional(),
});
export type AdminListTransactionsQuery = z.infer<typeof adminListTransactionsQuerySchema>;

export const adminAdjustBodySchema = z
  .object({
    direction: z.nativeEnum(LedgerDirection),
    bucket: z.enum([WalletBucket.DEPOSIT, WalletBucket.WINNING, WalletBucket.BONUS]),
    amount: moneyMajor(0.01, AppConstants.MONEY.WITHDRAW_MAX_MAJOR),
    currency: currencySchema,
    reason: z.string().min(8).max(500),
    ticketRef: z.string().max(64).optional(),
    notes: z.string().max(2000).optional(),
  })
  .transform((data) => ({
    ...data,
    amount: majorToMinor(data.amount),
  }));
export type AdminAdjustBody = z.infer<typeof adminAdjustBodySchema>;

export const adminFreezeBodySchema = z.object({
  reason: z.string().min(8).max(500),
});
export type AdminFreezeBody = z.infer<typeof adminFreezeBodySchema>;

export const adminUnfreezeBodySchema = z.object({
  reason: z.string().min(8).max(500),
});

export const adminRefundBodySchema = z.object({
  reason: z.string().min(8).max(500),
});
export type AdminRefundBody = z.infer<typeof adminRefundBodySchema>;

export const adminListActionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  actionType: z.nativeEnum(AdminWalletActionType).optional(),
  adminId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  targetUserId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type AdminListActionsQuery = z.infer<typeof adminListActionsQuerySchema>;

// Re-export the wallet status enum for the admin status endpoint validator
export { WalletStatus };

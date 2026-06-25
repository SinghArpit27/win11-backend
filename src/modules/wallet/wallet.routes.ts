import { Router } from 'express';

import {
  requireAuth,
  requireIdempotencyKey,
  requireRoles,
  validate,
  walletDepositRateLimiter,
  walletWithdrawRateLimiter,
  walletWriteRateLimiter,
  adminWalletWriteRateLimiter,
} from '@common/middlewares';
import { UserRole } from '@common/enums';

import {
  adminAdjustController,
  adminFreezeWalletController,
  adminListActionsController,
  adminListTransactionsController,
  adminLookupWalletController,
  adminRefundTransactionController,
  adminUnfreezeWalletController,
} from './wallet-admin.controller';
import {
  depositController,
  getMyTransactionController,
  getMyWalletController,
  listMyTransactionsController,
  summaryController,
  withdrawController,
} from './wallet.controller';
import {
  adminAdjustBodySchema,
  adminFreezeBodySchema,
  adminListActionsQuerySchema,
  adminListTransactionsQuerySchema,
  adminRefundBodySchema,
  adminUnfreezeBodySchema,
  depositBodySchema,
  historyQuerySchema,
  transactionParamsSchema,
  userIdParamsSchema,
  withdrawBodySchema,
} from './wallet.validators';

/**
 * Wallet routes.
 *
 * Two namespaces inside one router:
 *  - `/me/...`           → caller's own wallet (USER + admins).
 *  - `/admin/...`        → admin/support tools, RBAC-guarded.
 *
 * Middleware order matters:
 *  1. rate limiter (cheap, per-user)
 *  2. requireAuth (DB hit if cache miss)
 *  3. requireRoles (RBAC, after auth)
 *  4. requireIdempotencyKey on writes
 *  5. validate({ body / query / params })
 *  6. controller
 */
const router = Router();

// ────── User-facing endpoints ─────────────────────────────────────────────
router.get('/me', requireAuth, getMyWalletController);
router.get('/me/summary', requireAuth, summaryController);

router.get(
  '/me/transactions',
  requireAuth,
  validate({ query: historyQuerySchema }),
  listMyTransactionsController,
);

router.get(
  '/me/transactions/:transactionId',
  requireAuth,
  validate({ params: transactionParamsSchema }),
  getMyTransactionController,
);

router.post(
  '/me/deposit',
  walletDepositRateLimiter,
  requireAuth,
  requireIdempotencyKey(),
  validate({ body: depositBodySchema }),
  depositController,
);

router.post(
  '/me/withdraw',
  walletWithdrawRateLimiter,
  requireAuth,
  requireIdempotencyKey(),
  validate({ body: withdrawBodySchema }),
  withdrawController,
);

// ────── Admin endpoints ───────────────────────────────────────────────────
const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT] as const;
const WALLET_ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN] as const;

router.get(
  '/admin/transactions',
  walletWriteRateLimiter,
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ query: adminListTransactionsQuerySchema }),
  adminListTransactionsController,
);

router.get(
  '/admin/actions',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ query: adminListActionsQuerySchema }),
  adminListActionsController,
);

router.get(
  '/admin/users/:userId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: userIdParamsSchema }),
  adminLookupWalletController,
);

router.post(
  '/admin/users/:userId/adjust',
  adminWalletWriteRateLimiter,
  requireAuth,
  requireRoles(...WALLET_ADMIN_ROLES),
  requireIdempotencyKey(),
  validate({ params: userIdParamsSchema, body: adminAdjustBodySchema }),
  adminAdjustController,
);

router.post(
  '/admin/users/:userId/freeze',
  adminWalletWriteRateLimiter,
  requireAuth,
  requireRoles(...WALLET_ADMIN_ROLES),
  validate({ params: userIdParamsSchema, body: adminFreezeBodySchema }),
  adminFreezeWalletController,
);

router.post(
  '/admin/users/:userId/unfreeze',
  adminWalletWriteRateLimiter,
  requireAuth,
  requireRoles(...WALLET_ADMIN_ROLES),
  validate({ params: userIdParamsSchema, body: adminUnfreezeBodySchema }),
  adminUnfreezeWalletController,
);

router.post(
  '/admin/transactions/:transactionId/refund',
  adminWalletWriteRateLimiter,
  requireAuth,
  requireRoles(...WALLET_ADMIN_ROLES),
  requireIdempotencyKey(),
  validate({ params: transactionParamsSchema, body: adminRefundBodySchema }),
  adminRefundTransactionController,
);

export { router as walletRoutes };

import { Router } from 'express';

import {
  requireAuth,
  requireIdempotencyKey,
  requireRoles,
  validate,
  walletWithdrawRateLimiter,
} from '@common/middlewares';
import { UserRole } from '@common/enums';

import {
  adminApproveWithdrawalController,
  adminListPendingWithdrawalsController,
  adminRejectWithdrawalController,
  listMyWithdrawalsController,
  requestWithdrawalController,
} from './withdrawal.controller';
import {
  paginationQuerySchema,
  withdrawalParamsSchema,
  withdrawalRejectBodySchema,
  withdrawalRequestBodySchema,
} from './withdrawal.validators';

const router = Router();
const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN] as const;

router.post(
  '/',
  walletWithdrawRateLimiter,
  requireAuth,
  requireIdempotencyKey(),
  validate({ body: withdrawalRequestBodySchema }),
  requestWithdrawalController,
);

router.get('/me', requireAuth, validate({ query: paginationQuerySchema }), listMyWithdrawalsController);

router.get(
  '/admin/pending',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ query: paginationQuerySchema }),
  adminListPendingWithdrawalsController,
);

router.post(
  '/admin/:withdrawalId/approve',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: withdrawalParamsSchema }),
  adminApproveWithdrawalController,
);

router.post(
  '/admin/:withdrawalId/reject',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: withdrawalParamsSchema, body: withdrawalRejectBodySchema }),
  adminRejectWithdrawalController,
);

export { router as withdrawalRoutes };

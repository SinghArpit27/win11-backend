import express, { Router } from 'express';

import {
  requireAuth,
  requireIdempotencyKey,
  requireRoles,
  validate,
  walletDepositRateLimiter,
} from '@common/middlewares';
import { UserRole } from '@common/enums';

import {
  adminListPaymentsController,
  completeUpiPaymentController,
  createOrderController,
  listMyPaymentsController,
  mockCompletePaymentController,
  razorpayWebhookController,
  stripeWebhookController,
  verifyPaymentController,
} from './payment.controller';
import {
  completeUpiBodySchema,
  createOrderBodySchema,
  paymentListQuerySchema,
  verifyPaymentBodySchema,
} from './payment.validators';

const router = Router();
const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT] as const;

router.post(
  '/orders',
  walletDepositRateLimiter,
  requireAuth,
  requireIdempotencyKey(),
  validate({ body: createOrderBodySchema }),
  createOrderController,
);

router.post(
  '/verify',
  requireAuth,
  validate({ body: verifyPaymentBodySchema }),
  verifyPaymentController,
);

router.get(
  '/me',
  requireAuth,
  validate({ query: paymentListQuerySchema }),
  listMyPaymentsController,
);

router.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  stripeWebhookController,
);

router.post(
  '/webhooks/razorpay',
  express.raw({ type: 'application/json' }),
  razorpayWebhookController,
);

router.post('/mock/complete', requireAuth, mockCompletePaymentController);

router.post(
  '/upi/complete',
  requireAuth,
  validate({ body: completeUpiBodySchema }),
  completeUpiPaymentController,
);

router.get(
  '/admin',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ query: paymentListQuerySchema }),
  adminListPaymentsController,
);

export { router as paymentRoutes };

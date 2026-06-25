import { Router } from 'express';

import {
  forgotPasswordRateLimiter,
  loginRateLimiter,
  otpRequestRateLimiter,
  otpVerifyRateLimiter,
  refreshTokenRateLimiter,
  requireAuth,
  signupRateLimiter,
  validate,
} from '@common/middlewares';

import {
  changePasswordController,
  forgotPasswordController,
  loginController,
  logoutController,
  refreshController,
  requestOtpController,
  resetPasswordController,
  signupController,
  verifyEmailController,
  verifyOtpController,
} from './auth.controller';
import {
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  logoutBodySchema,
  refreshBodySchema,
  requestOtpBodySchema,
  resetPasswordBodySchema,
  signupBodySchema,
  verifyEmailBodySchema,
  verifyOtpBodySchema,
} from './auth.validators';

/**
 * Auth router.
 *
 * Order of middlewares is intentional:
 *  1. Endpoint-scoped rate limiter (cheap, fail-fast).
 *  2. Zod validate (so we don't hit DB for malformed requests).
 *  3. Controller.
 *
 * `requireAuth` is only applied to endpoints that need a logged-in caller
 * (logout, change-password). Public endpoints stay public.
 */
const router = Router();

router.post('/signup', signupRateLimiter, validate({ body: signupBodySchema }), signupController);
router.post('/login', loginRateLimiter, validate({ body: loginBodySchema }), loginController);
router.post(
  '/refresh',
  refreshTokenRateLimiter,
  validate({ body: refreshBodySchema }),
  refreshController,
);
router.post(
  '/logout',
  requireAuth,
  validate({ body: logoutBodySchema }),
  logoutController,
);

router.post(
  '/otp/request',
  otpRequestRateLimiter,
  validate({ body: requestOtpBodySchema }),
  requestOtpController,
);
router.post(
  '/otp/verify',
  otpVerifyRateLimiter,
  validate({ body: verifyOtpBodySchema }),
  verifyOtpController,
);

router.post(
  '/email/verify',
  otpVerifyRateLimiter,
  validate({ body: verifyEmailBodySchema }),
  verifyEmailController,
);

router.post(
  '/password/forgot',
  forgotPasswordRateLimiter,
  validate({ body: forgotPasswordBodySchema }),
  forgotPasswordController,
);
router.post(
  '/password/reset',
  otpVerifyRateLimiter,
  validate({ body: resetPasswordBodySchema }),
  resetPasswordController,
);
router.post(
  '/password/change',
  requireAuth,
  validate({ body: changePasswordBodySchema }),
  changePasswordController,
);

export { router as authRoutes };

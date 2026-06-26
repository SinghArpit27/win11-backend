import type { Request, Response } from 'express';

import { asyncHandler, sendCreated, sendSuccess } from '@common/utils';

import { authService } from './auth.service';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './auth.cookies';

/**
 * Auth controllers. They MUST stay thin:
 *  1. Pull validated DTOs from `req.body / params / query`,
 *  2. Delegate to `authService`,
 *  3. Decide HTTP status + response envelope.
 *
 * No business logic, no DB calls.
 */

export const signupController = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.signup(req.body, req);
  setRefreshCookie(res, result.tokens.refreshToken);
  return sendCreated(res, {
    user: result.user,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    accessExpiresIn: result.tokens.accessExpiresIn,
    refreshExpiresIn: result.tokens.refreshExpiresIn,
    sessionId: result.sessionId,
  });
});

export const loginController = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body, req);
  setRefreshCookie(res, result.tokens.refreshToken);
  return sendSuccess(res, {
    user: result.user,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    accessExpiresIn: result.tokens.accessExpiresIn,
    refreshExpiresIn: result.tokens.refreshExpiresIn,
    sessionId: result.sessionId,
  });
});

export const refreshController = asyncHandler(async (req: Request, res: Response) => {
  const bodyToken = (req.body as { refreshToken?: string })?.refreshToken;
  const cookieToken = readRefreshCookie(req.cookies ?? {});
  const presented = bodyToken ?? cookieToken ?? '';

  const tokens = await authService.refresh(presented, req);
  setRefreshCookie(res, tokens.refreshToken);
  return sendSuccess(res, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresIn: tokens.accessExpiresIn,
    refreshExpiresIn: tokens.refreshExpiresIn,
  });
});

export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  const { allDevices } = (req.body ?? {}) as { allDevices?: boolean };
  if (!req.user) return sendSuccess(res, { loggedOut: true });

  if (allDevices) {
    const revoked = await authService.logoutAll(req.user.id, req);
    clearRefreshCookie(res);
    return sendSuccess(res, { loggedOut: true, revoked });
  }

  await authService.logout(req.user.id, req.user.sessionId, req);
  clearRefreshCookie(res);
  return sendSuccess(res, { loggedOut: true });
});

export const requestOtpController = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.requestOtp(req.body, req);
  return sendSuccess(res, { accepted: true, expiresAt: result.expiresAt });
});

export const verifyOtpController = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.verifyOtp(req.body, req);
  return sendSuccess(res, result);
});

export const verifyEmailController = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.verifyEmail(req.body, req);
  return sendSuccess(res, { user });
});

export const forgotPasswordController = asyncHandler(async (req: Request, res: Response) => {
  await authService.forgotPassword(req.body, req);
  // Always 200 — do not leak account existence.
  return sendSuccess(res, { accepted: true });
});

export const resetPasswordController = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.resetPassword(req.body, req);
  return sendSuccess(res, result);
});

export const changePasswordController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new Error('unreachable — guarded by requireAuth');
  const result = await authService.changePassword(req.user.id, req.body, req);
  return sendSuccess(res, result);
});

export const phoneSendOtpController = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.sendPhoneAuthOtp(req.body, req);
  return sendSuccess(res, {
    accepted: true,
    expiresAt: result.expiresAt,
    isExistingUser: result.isExistingUser,
  });
});

export const phoneVerifyOtpController = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.verifyPhoneAuthOtp(req.body, req);
  setRefreshCookie(res, result.tokens.refreshToken);
  return sendSuccess(res, {
    user: result.user,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    accessExpiresIn: result.tokens.accessExpiresIn,
    refreshExpiresIn: result.tokens.refreshExpiresIn,
    sessionId: result.sessionId,
  });
});

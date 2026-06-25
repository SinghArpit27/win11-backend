import type { CookieOptions, Response } from 'express';

import { env, isProduction } from '@config/env.config';

/**
 * Centralised refresh-token cookie helpers.
 *
 * Why a cookie at all?
 *  - Mobile + native clients keep the refresh token in secure storage and
 *    send it via the JSON body.
 *  - Web clients keep it in an HttpOnly cookie so XSS can't exfiltrate it
 *    (the JWT access token still lives in memory; never in localStorage).
 *
 * The frontend signals which mode to use via `Accept` / a `?cookie=1` flag,
 * but for simplicity Phase 2 SETs the cookie on every login AND returns
 * the refresh token in the JSON body. The client picks whichever it needs.
 */

const REFRESH_COOKIE = 'w11_refresh';

const parseDurationMs = (spec: string): number => {
  const m = /^(\d+)([smhd])$/.exec(spec);
  if (!m) return 30 * 24 * 60 * 60 * 1000;
  const factors: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(m[1]) * (factors[m[2]] ?? 86_400_000);
};

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/',
  maxAge: parseDurationMs(env.JWT_REFRESH_TTL),
});

export const setRefreshCookie = (res: Response, refreshToken: string): void => {
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
};

export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: 0 });
};

export const readRefreshCookie = (cookies: Record<string, string>): string | undefined =>
  cookies[REFRESH_COOKIE];

export { REFRESH_COOKIE };

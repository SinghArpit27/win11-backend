import type { Request } from 'express';
import rateLimit, { Options } from 'express-rate-limit';
import RedisStore, { type RedisReply } from 'rate-limit-redis';

import { env } from '@config/env.config';
import { isRedisEnabled, redis } from '@config/redis.config';

import { ErrorCode, HttpStatus } from '@common/constants';

/**
 * Redis-backed rate limiter — cluster-safe across multiple API instances.
 * Use `createRateLimiter(...)` to declare scoped limits with a unique
 * `keyPrefix` so the buckets don't collide across endpoints.
 */
export const createRateLimiter = (
  overrides: Partial<Options> & { keyPrefix?: string } = {},
) => {
  const { keyPrefix = 'rl:', ...rest } = overrides;
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(isRedisEnabled()
      ? {
          store: new RedisStore({
            sendCommand: (...args: string[]): Promise<RedisReply> =>
              redis.call(args[0] as string, ...args.slice(1)) as Promise<RedisReply>,
            prefix: keyPrefix,
          }),
        }
      : {}),
    statusCode: HttpStatus.TOO_MANY_REQUESTS,
    message: {
      success: false,
      error: { code: ErrorCode.RATE_LIMITED, message: 'Too many requests, slow down.' },
    },
    ...rest,
  });
};

export const globalRateLimiter = createRateLimiter();

/**
 * Hybrid key generator — combines IP + identifier (email/phone) when the
 * body contains one. Stops attackers from masking attempts behind a
 * shared NAT IP while still throttling pure-IP floods.
 */
const ipPlusIdentifier = (req: Request): string => {
  const body = (req.body ?? {}) as { email?: string; phone?: string; identifier?: string };
  const id = (body.identifier ?? body.email ?? body.phone ?? '').toString().toLowerCase().trim();
  return `${req.ip ?? 'anon'}|${id || '-'}`;
};

// ─── Auth-specific limiters ────────────────────────────────────────────────
// Tight buckets for sensitive operations. Tunable via env later.

export const loginRateLimiter = createRateLimiter({
  keyPrefix: 'rl:auth:login:',
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: ipPlusIdentifier,
  skipSuccessfulRequests: true,
});

export const otpRequestRateLimiter = createRateLimiter({
  keyPrefix: 'rl:auth:otp-request:',
  windowMs: 60 * 60 * 1000,
  max: 6,
  keyGenerator: ipPlusIdentifier,
});

export const otpVerifyRateLimiter = createRateLimiter({
  keyPrefix: 'rl:auth:otp-verify:',
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: ipPlusIdentifier,
});

export const signupRateLimiter = createRateLimiter({
  keyPrefix: 'rl:auth:signup:',
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: ipPlusIdentifier,
});

export const forgotPasswordRateLimiter = createRateLimiter({
  keyPrefix: 'rl:auth:forgot:',
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: ipPlusIdentifier,
});

export const refreshTokenRateLimiter = createRateLimiter({
  keyPrefix: 'rl:auth:refresh:',
  windowMs: 60 * 1000,
  max: 20,
});

// ─── Wallet limiters (PHASE 3) ─────────────────────────────────────────────
// Per-user buckets — abuse here costs real money so the ceilings are low.
const userScopedKey = (req: Request): string => {
  const userId = req.user?.id;
  return userId ? `u:${userId}` : `ip:${req.ip ?? 'anon'}`;
};

export const walletWriteRateLimiter = createRateLimiter({
  keyPrefix: 'rl:wallet:write:',
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: userScopedKey,
});

export const walletDepositRateLimiter = createRateLimiter({
  keyPrefix: 'rl:wallet:deposit:',
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: userScopedKey,
});

export const walletWithdrawRateLimiter = createRateLimiter({
  keyPrefix: 'rl:wallet:withdraw:',
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: userScopedKey,
});

export const adminWalletWriteRateLimiter = createRateLimiter({
  keyPrefix: 'rl:wallet:admin:',
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: userScopedKey,
});

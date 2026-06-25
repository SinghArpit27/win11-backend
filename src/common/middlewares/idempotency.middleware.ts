import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppConstants, ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';

/**
 * Idempotency middleware.
 *
 * Enforces presence and shape of the `Idempotency-Key` header for write
 * endpoints whose at-most-once semantics matter (wallet credits / debits,
 * admin adjustments, refunds).
 *
 * The actual duplicate-detection lives inside `WalletService` because it
 * needs to be transactional with the ledger write — surface-level Redis
 * dedupe wouldn't be safe under a crash between the cache write and the
 * Mongo commit.
 *
 * Usage:
 *   router.post('/wallet/deposit', requireIdempotencyKey, ...)
 *
 * Options:
 *   - `optional: true`     → header is allowed but not required.
 *   - `maxLength: number`  → defaults to 128.
 */
interface Options {
  optional?: boolean;
  maxLength?: number;
}

const HEADER = AppConstants.IDEMPOTENCY_KEY_HEADER;
const DEFAULT_MAX = 128;
const KEY_RE = /^[A-Za-z0-9_\-:.]+$/;

export const requireIdempotencyKey = (options: Options = {}): RequestHandler => {
  const { optional = false, maxLength = DEFAULT_MAX } = options;

  return (req: Request, _res: Response, next: NextFunction): void => {
    const raw = req.header(HEADER);
    if (!raw) {
      if (optional) return next();
      return next(
        new AppError(
          'Idempotency-Key header is required for this endpoint',
          HttpStatus.BAD_REQUEST,
          ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        ),
      );
    }

    const key = raw.trim();
    if (!key || key.length > maxLength || !KEY_RE.test(key)) {
      return next(
        new AppError(
          `Idempotency-Key must be 1-${maxLength} chars matching [A-Za-z0-9_-:.]`,
          HttpStatus.BAD_REQUEST,
          ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        ),
      );
    }

    // Expose a normalised, header-trimmed copy to controllers/services so
    // they don't re-read the header themselves.
    req.idempotencyKey = key;
    next();
  };
};

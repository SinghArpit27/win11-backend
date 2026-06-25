import type { AuthenticatedUser, DeviceContext } from './common.types';

declare global {
  namespace Express {
    interface Request {
      id: string;
      correlationId?: string;
      user?: AuthenticatedUser;
      device?: DeviceContext;
      startedAt?: number;
      /** Set by `requireIdempotencyKey`. Normalised + validated header. */
      idempotencyKey?: string;
    }
  }
}

export {};

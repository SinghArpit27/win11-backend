import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps async controllers so unhandled rejections are forwarded to the
 * global error middleware instead of crashing the process.
 */
export const asyncHandler =
  <T = unknown>(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<T>,
  ): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

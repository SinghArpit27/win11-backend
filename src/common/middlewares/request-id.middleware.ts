import type { NextFunction, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';

import { AppConstants } from '@common/constants';

/**
 * Ensures every request has a stable `x-request-id`.
 * - Honours client-provided header (useful for end-to-end tracing).
 * - Generates a v4 UUID otherwise.
 * - Echoes back to the client for client-side log correlation.
 */
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.header(AppConstants.REQUEST_ID_HEADER);
  const id = incoming && incoming.length <= 64 ? incoming : uuid();
  req.id = id;
  req.correlationId = req.header(AppConstants.CORRELATION_ID_HEADER) ?? id;
  res.setHeader(AppConstants.REQUEST_ID_HEADER, id);
  req.startedAt = Date.now();
  next();
};

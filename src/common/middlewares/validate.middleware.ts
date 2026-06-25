import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, ZodSchema } from 'zod';

import { ValidationError } from '@common/errors';

type Source = 'body' | 'query' | 'params' | 'headers';

interface ValidateOptions {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
  headers?: ZodSchema;
}

/**
 * Reusable validation middleware backed by Zod.
 * Parses + replaces the request fragment with the typed, sanitised value.
 */
export const validate = (schemas: ValidateOptions): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      (Object.keys(schemas) as Source[]).forEach((key) => {
        const schema = schemas[key];
        if (!schema) return;
        const parsed = schema.parse(req[key]);
        // We intentionally cast: Express types don't know about Zod's stricter shape.
        (req as unknown as Record<Source, unknown>)[key] = parsed;
      });
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.flatten();
        next(new ValidationError('Invalid request payload', details));
        return;
      }
      next(err);
    }
  };
};

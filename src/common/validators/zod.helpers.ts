import { z } from 'zod';

/**
 * Shared Zod primitives for HTTP validators.
 *
 * Every module validator SHOULD import from here instead of redefining
 * ObjectId regex / pagination shapes — keeps error messages and bounds
 * consistent across the API surface.
 */

export const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;

/** Validates a single Mongo ObjectId string (24 hex chars). */
export const objectIdString = (field: string) =>
  z.string().regex(OBJECT_ID_REGEX, `Invalid ${field}`);

export interface PaginationSchemaOptions {
  maxLimit?: number;
  defaultLimit?: number;
}

/** Standard list pagination query — matches wallet / sports / contest modules. */
export const buildPaginationSchema = (options: PaginationSchemaOptions = {}) =>
  z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(options.maxLimit ?? 100)
      .default(options.defaultLimit ?? 20),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  });

/** Default pagination schema used by most list endpoints. */
export const paginationSchema = buildPaginationSchema();

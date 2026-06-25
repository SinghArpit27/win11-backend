import { z } from 'zod';

import { AppConstants } from '@common/constants';
import { SortOrder } from '@common/enums';

/**
 * Reusable Zod schema for paginated list endpoints.
 * Compose with module-specific filter schemas.
 *
 *   const listUsersQuery = paginationQuerySchema.extend({ search: z.string().optional() });
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(AppConstants.DEFAULT_PAGE),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(AppConstants.MAX_PAGE_SIZE)
    .default(AppConstants.DEFAULT_PAGE_SIZE),
  sortBy: z.string().min(1).max(64).optional(),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
});

export type PaginationQueryDto = z.infer<typeof paginationQuerySchema>;

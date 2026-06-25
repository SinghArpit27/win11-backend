import { AppConstants } from '@common/constants';
import type { PaginationMeta, PaginationParams } from '@common/types/common.types';

/**
 * Normalises pagination params from raw query input.
 * Caps `limit` to a hard maximum to protect MongoDB from large scans.
 */
export const parsePagination = (
  query: Partial<Record<keyof PaginationParams, unknown>>,
): PaginationParams => {
  const page = Math.max(1, Number(query.page) || AppConstants.DEFAULT_PAGE);
  const requested = Number(query.limit) || AppConstants.DEFAULT_PAGE_SIZE;
  const limit = Math.min(Math.max(1, requested), AppConstants.MAX_PAGE_SIZE);

  return {
    page,
    limit,
    sortBy: typeof query.sortBy === 'string' ? query.sortBy : undefined,
    sortOrder: query.sortOrder === 'asc' ? 'asc' : 'desc',
  };
};

export const buildPaginationMeta = (
  total: number,
  { page, limit }: Pick<PaginationParams, 'page' | 'limit'>,
): PaginationMeta => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
};

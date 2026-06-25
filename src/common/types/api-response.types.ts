import type { PaginationMeta } from '@common/types/common.types';
import type { ErrorCodeValue } from '@common/constants';

/**
 * Canonical API response envelope.
 * Every response — success or failure — conforms to this shape so mobile
 * clients can parse uniformly.
 */

/** Meta block on success responses — pagination or arbitrary key/value. */
export type ApiResponseMeta = Record<string, unknown> | PaginationMeta;

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ApiResponseMeta;
  requestId?: string;
  timestamp: string;
}

export interface ApiFailure {
  success: false;
  error: {
    code: ErrorCodeValue;
    message: string;
    details?: unknown;
  };
  requestId?: string;
  timestamp: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

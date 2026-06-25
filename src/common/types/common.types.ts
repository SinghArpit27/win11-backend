import type { Request } from 'express';

import type { ClientPlatform, UserRole } from '@common/enums';

/**
 * Shared cross-cutting type aliases.
 */
export type ID = string;

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type Maybe<T> = T | null | undefined;

export interface AuthenticatedUser {
  id: ID;
  /**
   * @deprecated Prefer `roles`. Kept for backwards compat — equal to `roles[0]`.
   */
  role: UserRole;
  roles: UserRole[];
  email?: string;
  phone?: string;
  sessionId: ID;
}

export interface DeviceContext {
  deviceId?: string;
  platform?: ClientPlatform;
  appVersion?: string;
  ip?: string;
  userAgent?: string;
}

export interface AuthedRequest extends Request {
  user: AuthenticatedUser;
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

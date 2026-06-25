import { z } from 'zod';

import { UserRole, UserStatus } from '@common/enums';

export const updateMeBodySchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  username: z
    .string()
    .regex(/^[a-zA-Z0-9_]{3,20}$/)
    .optional(),
  avatarUrl: z.string().url().optional(),
});
export type UpdateMeBody = z.infer<typeof updateMeBodySchema>;

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  q: z.string().trim().optional(),
  status: z.nativeEnum(UserStatus).optional(),
  role: z.nativeEnum(UserRole).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const userIdParamsSchema = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid user id'),
});
export type UserIdParams = z.infer<typeof userIdParamsSchema>;

export const adminUpdateUserBodySchema = z.object({
  status: z.nativeEnum(UserStatus).optional(),
  roles: z.array(z.nativeEnum(UserRole)).min(1).optional(),
  displayName: z.string().min(1).max(64).optional(),
});
export type AdminUpdateUserBody = z.infer<typeof adminUpdateUserBodySchema>;

import type { Request, Response } from 'express';

import { asyncHandler, sendSuccess } from '@common/utils';

import { userService } from './user.service';

export const getMeController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new Error('unreachable — guarded by requireAuth');
  const user = await userService.getById(req.user.id);
  return sendSuccess(res, { user });
});

export const updateMeController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new Error('unreachable — guarded by requireAuth');
  const user = await userService.updateMe(req.user.id, req.body);
  return sendSuccess(res, { user });
});

export const adminListUsersController = asyncHandler(async (req: Request, res: Response) => {
  const result = await userService.listForAdmin(
    req.query as unknown as Parameters<typeof userService.listForAdmin>[0],
  );
  return sendSuccess(res, result.items, { meta: result.meta });
});

export const adminGetUserController = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.getById((req.params as { userId: string }).userId);
  return sendSuccess(res, { user });
});

export const adminUpdateUserController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new Error('unreachable — guarded by requireAuth');
  const user = await userService.adminUpdateUser(
    req.user.id,
    req.user.roles,
    (req.params as { userId: string }).userId,
    req.body,
    req,
  );
  return sendSuccess(res, { user });
});

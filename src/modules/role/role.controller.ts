import type { Request, Response } from 'express';

import { asyncHandler, sendSuccess } from '@common/utils';

import { roleService } from './role.service';

export const adminListRolesController = asyncHandler(async (_req: Request, res: Response) => {
  const roles = await roleService.list();
  return sendSuccess(res, { roles });
});

import { Router } from 'express';

import { UserRole } from '@common/enums';
import { requireAuth, requireRoles } from '@common/middlewares';

import { adminListRolesController } from './role.controller';

const router = Router();

router.get(
  '/',
  requireAuth,
  requireRoles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT),
  adminListRolesController,
);

export { router as roleRoutes };

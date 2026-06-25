import { Router } from 'express';

import { UserRole } from '@common/enums';
import { requireAuth, requireRoles, validate } from '@common/middlewares';

import {
  adminRevokeAllSessionsController,
  listMySessionsController,
  revokeMySessionController,
} from './session.controller';
import { sessionIdParamsSchema, userIdParamsSchema } from './session.validators';

const router = Router();

router.get('/me', requireAuth, listMySessionsController);
router.delete(
  '/me/:sessionId',
  requireAuth,
  validate({ params: sessionIdParamsSchema }),
  revokeMySessionController,
);

router.delete(
  '/admin/users/:userId',
  requireAuth,
  requireRoles(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validate({ params: userIdParamsSchema }),
  adminRevokeAllSessionsController,
);

export { router as sessionRoutes };

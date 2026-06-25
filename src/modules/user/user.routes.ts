import { Router } from 'express';

import { UserRole } from '@common/enums';
import { requireAuth, requireRoles, validate } from '@common/middlewares';

import {
  adminGetUserController,
  adminListUsersController,
  adminUpdateUserController,
  getMeController,
  updateMeController,
} from './user.controller';
import {
  adminUpdateUserBodySchema,
  listUsersQuerySchema,
  updateMeBodySchema,
  userIdParamsSchema,
} from './user.validators';

/**
 * `/users` router.
 *
 * Routes split into two layers:
 *  - `/me`  — caller acts on their own record (any logged-in user).
 *  - `/admin/...` — admin-only operations, RBAC enforced by `requireRoles`.
 *
 * The frontend admin panel hits the `/admin` namespace.
 */
const router = Router();

router.get('/me', requireAuth, getMeController);
router.patch('/me', requireAuth, validate({ body: updateMeBodySchema }), updateMeController);

const adminRouter = Router();
adminRouter.use(requireAuth, requireRoles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT));
adminRouter.get('/', validate({ query: listUsersQuerySchema }), adminListUsersController);
adminRouter.get('/:userId', validate({ params: userIdParamsSchema }), adminGetUserController);
adminRouter.patch(
  '/:userId',
  validate({ params: userIdParamsSchema, body: adminUpdateUserBodySchema }),
  adminUpdateUserController,
);

router.use('/admin', adminRouter);

export { router as userRoutes };

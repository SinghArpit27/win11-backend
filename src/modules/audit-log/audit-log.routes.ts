import { Router } from 'express';

import { UserRole } from '@common/enums';
import { requireAuth, requireRoles, validate } from '@common/middlewares';

import { adminListAuditLogsController } from './audit-log.controller';
import { listAuditLogsQuerySchema } from './audit-log.validators';

const router = Router();

router.get(
  '/',
  requireAuth,
  requireRoles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT),
  validate({ query: listAuditLogsQuerySchema }),
  adminListAuditLogsController,
);

export { router as auditLogRoutes };

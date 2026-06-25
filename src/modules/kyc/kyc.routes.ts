import { Router } from 'express';

import { requireAuth, requireRoles, validate } from '@common/middlewares';
import { UserRole } from '@common/enums';

import {
  adminApproveKycController,
  adminListPendingKycController,
  adminRejectKycController,
  getMyKycController,
  submitKycController,
  uploadKycDocumentController,
} from './kyc.controller';
import {
  kycDocumentBodySchema,
  kycParamsSchema,
  kycRejectBodySchema,
  kycSubmitBodySchema,
  paginationQuerySchema,
} from './kyc.validators';

const router = Router();
const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN] as const;

router.get('/me', requireAuth, getMyKycController);
router.post('/me/submit', requireAuth, validate({ body: kycSubmitBodySchema }), submitKycController);
router.post('/me/documents', requireAuth, validate({ body: kycDocumentBodySchema }), uploadKycDocumentController);

router.get(
  '/admin/pending',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ query: paginationQuerySchema }),
  adminListPendingKycController,
);

router.post(
  '/admin/:profileId/approve',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: kycParamsSchema }),
  adminApproveKycController,
);

router.post(
  '/admin/:profileId/reject',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: kycParamsSchema, body: kycRejectBodySchema }),
  adminRejectKycController,
);

export { router as kycRoutes };

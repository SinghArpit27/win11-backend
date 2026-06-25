import { Router } from 'express';

import { requireAuth, requireRoles } from '@common/middlewares';
import { UserRole } from '@common/enums';
import { asyncHandler, sendSuccess } from '@common/utils';
import { parsePagination } from '@common/utils/pagination.util';

import { FinancialSettlement } from '@modules/financial-settlement/settlement.model';
import { riskEngineService } from '@modules/risk/risk-engine.service';

const router = Router();
const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT] as const;

router.get(
  '/flags',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query as { page?: string; limit?: string });
    const result = await riskEngineService.listOpen(pagination);
    return sendSuccess(res, result.items, { meta: result.meta });
  }),
);

router.post(
  '/flags/:flagId/resolve',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ success: false });
    await riskEngineService.resolve(req.params.flagId!, req.user.id);
    return sendSuccess(res, { resolved: true });
  }),
);

router.get(
  '/settlements',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query as { page?: string; limit?: string });
    const skip = (pagination.page - 1) * pagination.limit;
    const [items, total] = await Promise.all([
      FinancialSettlement.find().sort({ createdAt: -1 }).skip(skip).limit(pagination.limit).exec(),
      FinancialSettlement.countDocuments(),
    ]);
    return sendSuccess(res, items, {
      meta: { ...pagination, total, totalPages: Math.ceil(total / pagination.limit) || 1 },
    });
  }),
);

export { router as financialAdminRoutes };

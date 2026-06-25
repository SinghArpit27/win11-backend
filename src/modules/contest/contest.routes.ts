import { Router } from 'express';

import { UserRole } from '@common/enums';
import {
  optionalAuth,
  requireAuth,
  requireRoles,
  validate,
} from '@common/middlewares';

import {
  adminCancelContestController,
  adminCloneContestController,
  adminCreateContestController,
  adminCreateContestTemplateController,
  adminCreatePrizeDistributionController,
  adminDeleteContestTemplateController,
  adminDeletePrizeDistributionController,
  adminGetContestController,
  adminGetContestTemplateController,
  adminGetPrizeDistributionController,
  adminListContestEntriesController,
  adminListContestTemplatesController,
  adminListContestsController,
  adminListPrizeDistributionsController,
  adminTransitionContestStatusController,
  adminUpdateContestController,
  adminUpdateContestTemplateController,
  adminUpdatePrizeDistributionController,
  getContestController,
  getMyContestEntryController,
  joinContestController,
  listContestsController,
  listMyContestEntriesController,
  listMyEntriesForContestController,
  lookupContestByInviteCodeController,
} from './contest.controller';
import {
  adminContestCancelBodySchema,
  adminContestCreateBodySchema,
  adminContestListQuerySchema,
  adminContestStatusBodySchema,
  adminContestUpdateBodySchema,
  contestCloneBodySchema,
  contestEntryListQuerySchema,
  contestEntryParamsSchema,
  contestInviteCodeQuerySchema,
  contestJoinBodySchema,
  contestListQuerySchema,
  contestParamsSchema,
  contestTemplateCreateBodySchema,
  contestTemplateListQuerySchema,
  contestTemplateParamsSchema,
  contestTemplateUpdateBodySchema,
  prizeDistributionCreateBodySchema,
  prizeDistributionListQuerySchema,
  prizeDistributionParamsSchema,
  prizeDistributionUpdateBodySchema,
} from './contest.validators';

/**
 * Contest routes — mounted at `/api/v1/contests`.
 *
 *   User-facing:
 *     - GET    /                              — list contests (filterable by match)
 *     - GET    /lookup                        — find a private contest by invite code
 *     - GET    /:contestId
 *     - POST   /:contestId/join               — join with a fantasy team
 *     - GET    /:contestId/my-entries         — caller's entries inside a contest
 *     - GET    /entries                       — caller's all entries (paginated)
 *     - GET    /entries/:entryId
 *
 *   Admin (RBAC-guarded):
 *     - /admin/contests                — CRUD + clone + cancel + status
 *     - /admin/contests/:contestId/entries
 *     - /admin/templates               — CRUD
 *     - /admin/prize-distributions     — CRUD
 */
const router = Router();

const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN] as const;

// ─── User-facing ──────────────────────────────────────────────────────

router.get(
  '/',
  optionalAuth,
  validate({ query: contestListQuerySchema }),
  listContestsController,
);

router.get(
  '/lookup',
  optionalAuth,
  validate({ query: contestInviteCodeQuerySchema }),
  lookupContestByInviteCodeController,
);

// User entries — keep ABOVE `:contestId` so /entries matches first.
router.get(
  '/entries',
  requireAuth,
  validate({ query: contestEntryListQuerySchema }),
  listMyContestEntriesController,
);

router.get(
  '/entries/:entryId',
  requireAuth,
  validate({ params: contestEntryParamsSchema }),
  getMyContestEntryController,
);

router.get(
  '/:contestId',
  optionalAuth,
  validate({ params: contestParamsSchema }),
  getContestController,
);

router.post(
  '/:contestId/join',
  requireAuth,
  validate({ params: contestParamsSchema, body: contestJoinBodySchema }),
  joinContestController,
);

router.get(
  '/:contestId/my-entries',
  requireAuth,
  validate({ params: contestParamsSchema }),
  listMyEntriesForContestController,
);

// ─── Admin — contests ────────────────────────────────────────────────

router.get(
  '/admin/contests',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ query: adminContestListQuerySchema }),
  adminListContestsController,
);

router.post(
  '/admin/contests',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ body: adminContestCreateBodySchema }),
  adminCreateContestController,
);

router.get(
  '/admin/contests/:contestId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestParamsSchema }),
  adminGetContestController,
);

router.patch(
  '/admin/contests/:contestId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestParamsSchema, body: adminContestUpdateBodySchema }),
  adminUpdateContestController,
);

router.post(
  '/admin/contests/:contestId/clone',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestParamsSchema, body: contestCloneBodySchema }),
  adminCloneContestController,
);

router.post(
  '/admin/contests/:contestId/status',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestParamsSchema, body: adminContestStatusBodySchema }),
  adminTransitionContestStatusController,
);

router.post(
  '/admin/contests/:contestId/cancel',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestParamsSchema, body: adminContestCancelBodySchema }),
  adminCancelContestController,
);

router.get(
  '/admin/contests/:contestId/entries',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestParamsSchema, query: contestEntryListQuerySchema }),
  adminListContestEntriesController,
);

// ─── Admin — templates ───────────────────────────────────────────────

router.get(
  '/admin/templates',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ query: contestTemplateListQuerySchema }),
  adminListContestTemplatesController,
);

router.post(
  '/admin/templates',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ body: contestTemplateCreateBodySchema }),
  adminCreateContestTemplateController,
);

router.get(
  '/admin/templates/:templateId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestTemplateParamsSchema }),
  adminGetContestTemplateController,
);

router.patch(
  '/admin/templates/:templateId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestTemplateParamsSchema, body: contestTemplateUpdateBodySchema }),
  adminUpdateContestTemplateController,
);

router.delete(
  '/admin/templates/:templateId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestTemplateParamsSchema }),
  adminDeleteContestTemplateController,
);

// ─── Admin — prize distributions ─────────────────────────────────────

router.get(
  '/admin/prize-distributions',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ query: prizeDistributionListQuerySchema }),
  adminListPrizeDistributionsController,
);

router.post(
  '/admin/prize-distributions',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ body: prizeDistributionCreateBodySchema }),
  adminCreatePrizeDistributionController,
);

router.get(
  '/admin/prize-distributions/:distributionId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: prizeDistributionParamsSchema }),
  adminGetPrizeDistributionController,
);

router.patch(
  '/admin/prize-distributions/:distributionId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: prizeDistributionParamsSchema, body: prizeDistributionUpdateBodySchema }),
  adminUpdatePrizeDistributionController,
);

router.delete(
  '/admin/prize-distributions/:distributionId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: prizeDistributionParamsSchema }),
  adminDeletePrizeDistributionController,
);

export { router as contestRoutes };

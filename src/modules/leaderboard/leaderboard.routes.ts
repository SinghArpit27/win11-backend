import { Router } from 'express';

import { UserRole } from '@common/enums';
import { optionalAuth, requireAuth, requireRoles, validate } from '@common/middlewares';

import {
  adminGetSettlementController,
  adminListSnapshotsController,
  adminRebuildLeaderboardController,
  adminResetSettlementController,
  adminSettleContestController,
  getContestLeaderboardController,
  getContestResultController,
  getMyContestRankController,
  getMyRankHistoryController,
  getMyRecentRankHistoryController,
} from './leaderboard.controller';
import {
  contestIdParamSchema,
  leaderboardPageQuerySchema,
  rankHistoryQuerySchema,
  rebuildLeaderboardBodySchema,
  settleContestBodySchema,
} from './leaderboard.validators';

/**
 * Leaderboard routes — mounted at `/api/v1/leaderboard`.
 *
 *   User-facing:
 *     - GET    /contests/:contestId                  — paginated leaderboard
 *     - GET    /contests/:contestId/me               — my best rank in the contest
 *     - GET    /contests/:contestId/me/history       — my rank history
 *     - GET    /contests/:contestId/result           — settlement summary
 *     - GET    /me/history                           — recent cross-contest movement
 *
 *   Admin (RBAC-guarded):
 *     - POST   /admin/contests/:contestId/rebuild
 *     - GET    /admin/contests/:contestId/snapshots
 *     - POST   /admin/contests/:contestId/settle
 *     - POST   /admin/contests/:contestId/reset
 *     - GET    /admin/contests/:contestId/result
 */
const router = Router();

const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN] as const;

// ─── User-facing ──────────────────────────────────────────────────────

router.get(
  '/me/history',
  requireAuth,
  getMyRecentRankHistoryController,
);

router.get(
  '/contests/:contestId',
  optionalAuth,
  validate({ params: contestIdParamSchema, query: leaderboardPageQuerySchema }),
  getContestLeaderboardController,
);

router.get(
  '/contests/:contestId/me',
  requireAuth,
  validate({ params: contestIdParamSchema }),
  getMyContestRankController,
);

router.get(
  '/contests/:contestId/me/history',
  requireAuth,
  validate({ params: contestIdParamSchema, query: rankHistoryQuerySchema }),
  getMyRankHistoryController,
);

router.get(
  '/contests/:contestId/result',
  optionalAuth,
  validate({ params: contestIdParamSchema }),
  getContestResultController,
);

// ─── Admin ────────────────────────────────────────────────────────────

router.post(
  '/admin/contests/:contestId/rebuild',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestIdParamSchema, body: rebuildLeaderboardBodySchema }),
  adminRebuildLeaderboardController,
);

router.get(
  '/admin/contests/:contestId/snapshots',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestIdParamSchema }),
  adminListSnapshotsController,
);

router.post(
  '/admin/contests/:contestId/settle',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestIdParamSchema, body: settleContestBodySchema }),
  adminSettleContestController,
);

router.post(
  '/admin/contests/:contestId/reset',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestIdParamSchema }),
  adminResetSettlementController,
);

router.get(
  '/admin/contests/:contestId/result',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: contestIdParamSchema }),
  adminGetSettlementController,
);

export { router as leaderboardRoutes };

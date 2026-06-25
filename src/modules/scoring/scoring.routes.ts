import { Router } from 'express';

import { UserRole } from '@common/enums';
import { optionalAuth, requireAuth, requireRoles, validate } from '@common/middlewares';

import {
  adminAdjustPlayerPointsController,
  adminGetScoringStatusController,
  adminListScoreEventsController,
  adminRecomputeMatchController,
  getMatchFantasyPointsController,
  getPlayerFantasyPointsController,
} from './scoring.controller';
import {
  adjustPlayerPointsBodySchema,
  listScoreEventsQuerySchema,
  matchIdParamSchema,
  matchPlayerParamSchema,
  recomputeMatchBodySchema,
} from './scoring.validators';

/**
 * Scoring routes — mounted at `/api/v1/scoring`.
 *
 * User-facing reads + admin scoring tools.
 */
const router = Router();

const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN] as const;

// ─── User-facing reads ───────────────────────────────────────────────

router.get(
  '/matches/:matchId/fantasy-points',
  optionalAuth,
  validate({ params: matchIdParamSchema }),
  getMatchFantasyPointsController,
);

router.get(
  '/matches/:matchId/players/:playerId/fantasy-points',
  optionalAuth,
  validate({ params: matchPlayerParamSchema }),
  getPlayerFantasyPointsController,
);

// ─── Admin ───────────────────────────────────────────────────────────

router.post(
  '/admin/matches/:matchId/recompute',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: matchIdParamSchema, body: recomputeMatchBodySchema }),
  adminRecomputeMatchController,
);

router.post(
  '/admin/matches/:matchId/players/:playerId/adjust',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: matchPlayerParamSchema, body: adjustPlayerPointsBodySchema }),
  adminAdjustPlayerPointsController,
);

router.get(
  '/admin/matches/:matchId/events',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: matchIdParamSchema, query: listScoreEventsQuerySchema }),
  adminListScoreEventsController,
);

router.get(
  '/admin/matches/:matchId/status',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: matchIdParamSchema }),
  adminGetScoringStatusController,
);

export { router as scoringRoutes };

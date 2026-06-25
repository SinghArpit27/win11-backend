import { Router } from 'express';

import { UserRole } from '@common/enums';
import {
  optionalAuth,
  requireAuth,
  requireRoles,
  validate,
} from '@common/middlewares';

import {
  adminCancelMatchController,
  adminFeatureMatchController,
  adminFlushCacheController,
  adminSyncController,
  getMatchController,
  getMatchPlayersController,
  getMatchUpdatesController,
  getPlayerController,
  getPlayerStatsController,
  getTeamController,
  getTeamRosterController,
  getTournamentController,
  listFeaturedMatchesController,
  listLiveMatchesController,
  listMatchesController,
  listPlayersController,
  listTeamsController,
  listTournamentsController,
  listTrendingMatchesController,
  listUpcomingMatchesController,
} from './sports.controller';
import {
  adminCacheFlushBodySchema,
  adminCancelMatchBodySchema,
  adminFeatureBodySchema,
  adminSyncBodySchema,
  matchListQuerySchema,
  matchParamsSchema,
  matchUpdatesQuerySchema,
  playerListQuerySchema,
  playerParamsSchema,
  teamListQuerySchema,
  teamParamsSchema,
  tournamentListQuerySchema,
  tournamentParamsSchema,
} from './sports.validators';

/**
 * Sports routes.
 *
 *  Two namespaces inside one router:
 *   - `/matches/*`, `/tournaments/*`, `/teams/*`, `/players/*`
 *      — public reads (optional auth — anonymous browsing supported).
 *   - `/admin/*`
 *      — admin sync / feature / cancel / cache-flush (RBAC-guarded).
 *
 *  Middleware order matters:
 *   1. `optionalAuth` on public reads — enriches with `req.user` if a token
 *      is provided, but does not fail anonymous callers.
 *   2. `validate({ query / params / body })` — runs after auth so 401s
 *      are returned before validation errors leak the schema.
 *   3. controller.
 */

const router = Router();

const ADMIN_SPORTS_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN] as const;

// ─── Matches (public) ─────────────────────────────────────────────────────
router.get(
  '/matches',
  optionalAuth,
  validate({ query: matchListQuerySchema }),
  listMatchesController,
);
router.get(
  '/matches/live',
  optionalAuth,
  validate({ query: matchListQuerySchema }),
  listLiveMatchesController,
);
router.get(
  '/matches/upcoming',
  optionalAuth,
  validate({ query: matchListQuerySchema }),
  listUpcomingMatchesController,
);
router.get(
  '/matches/featured',
  optionalAuth,
  validate({ query: matchListQuerySchema }),
  listFeaturedMatchesController,
);
router.get(
  '/matches/trending',
  optionalAuth,
  validate({ query: matchListQuerySchema }),
  listTrendingMatchesController,
);
router.get(
  '/matches/:matchId',
  optionalAuth,
  validate({ params: matchParamsSchema }),
  getMatchController,
);
router.get(
  '/matches/:matchId/updates',
  optionalAuth,
  validate({ params: matchParamsSchema, query: matchUpdatesQuerySchema }),
  getMatchUpdatesController,
);
router.get(
  '/matches/:matchId/players',
  optionalAuth,
  validate({ params: matchParamsSchema }),
  getMatchPlayersController,
);

// ─── Tournaments ──────────────────────────────────────────────────────────
router.get(
  '/tournaments',
  optionalAuth,
  validate({ query: tournamentListQuerySchema }),
  listTournamentsController,
);
router.get(
  '/tournaments/:tournamentId',
  optionalAuth,
  validate({ params: tournamentParamsSchema }),
  getTournamentController,
);

// ─── Teams ────────────────────────────────────────────────────────────────
router.get('/teams', optionalAuth, validate({ query: teamListQuerySchema }), listTeamsController);
router.get(
  '/teams/:teamId',
  optionalAuth,
  validate({ params: teamParamsSchema }),
  getTeamController,
);
router.get(
  '/teams/:teamId/roster',
  optionalAuth,
  validate({ params: teamParamsSchema }),
  getTeamRosterController,
);

// ─── Players ──────────────────────────────────────────────────────────────
router.get(
  '/players',
  optionalAuth,
  validate({ query: playerListQuerySchema }),
  listPlayersController,
);
router.get(
  '/players/:playerId',
  optionalAuth,
  validate({ params: playerParamsSchema }),
  getPlayerController,
);
router.get(
  '/players/:playerId/stats',
  optionalAuth,
  validate({ params: playerParamsSchema }),
  getPlayerStatsController,
);

// ─── Admin ────────────────────────────────────────────────────────────────
router.post(
  '/admin/sync',
  requireAuth,
  requireRoles(...ADMIN_SPORTS_ROLES),
  validate({ body: adminSyncBodySchema }),
  adminSyncController,
);

router.post(
  '/admin/matches/:matchId/feature',
  requireAuth,
  requireRoles(...ADMIN_SPORTS_ROLES),
  validate({ params: matchParamsSchema, body: adminFeatureBodySchema }),
  adminFeatureMatchController,
);

router.post(
  '/admin/matches/:matchId/cancel',
  requireAuth,
  requireRoles(...ADMIN_SPORTS_ROLES),
  validate({ params: matchParamsSchema, body: adminCancelMatchBodySchema }),
  adminCancelMatchController,
);

router.post(
  '/admin/cache/flush',
  requireAuth,
  requireRoles(...ADMIN_SPORTS_ROLES),
  validate({ body: adminCacheFlushBodySchema }),
  adminFlushCacheController,
);

export { router as sportsRoutes };

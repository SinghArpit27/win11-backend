import { Router } from 'express';

import { UserRole } from '@common/enums';
import {
  optionalAuth,
  requireAuth,
  requireRoles,
  validate,
} from '@common/middlewares';

import {
  adminActivateFantasyRuleController,
  adminActivateFantasyScoringRuleController,
  adminCreateFantasyRuleController,
  adminCreateFantasyScoringRuleController,
  adminGetFantasyRuleController,
  adminGetFantasyScoringRuleController,
  adminListFantasyRulesController,
  adminListFantasyScoringRulesController,
  adminUpdateFantasyRuleController,
  adminUpdateFantasyScoringRuleController,
  cloneFantasyTeamController,
  createFantasyTeamController,
  deleteFantasyDraftController,
  deleteFantasyTeamController,
  getFantasyMatchContextController,
  getFantasyMatchRuleController,
  getMyFantasyTeamController,
  listMyFantasyDraftsController,
  listMyFantasyTeamsController,
  previewFantasyTeamController,
  updateFantasyTeamController,
  upsertFantasyDraftController,
} from './fantasy.controller';
import {
  fantasyDraftListQuerySchema,
  fantasyDraftParamsSchema,
  fantasyDraftUpsertBodySchema,
  fantasyMatchContextParamsSchema,
  fantasyRuleCreateBodySchema,
  fantasyRuleListQuerySchema,
  fantasyRuleParamsSchema,
  fantasyRuleUpdateBodySchema,
  fantasyScoringRuleCreateBodySchema,
  fantasyScoringRuleListQuerySchema,
  fantasyScoringRuleParamsSchema,
  fantasyScoringRuleUpdateBodySchema,
  fantasyTeamCloneBodySchema,
  fantasyTeamCreateBodySchema,
  fantasyTeamListQuerySchema,
  fantasyTeamParamsSchema,
  fantasyTeamPreviewBodySchema,
  fantasyTeamUpdateBodySchema,
} from './fantasy.validators';

/**
 * Fantasy routes — mounted at `/api/v1/fantasy`.
 *
 *   Public-ish reads (require auth so we can scope user-specific data):
 *     - GET    /matches/:matchId/context        — players + active rules
 *     - GET    /matches/:matchId/rules          — slim rule lookup
 *     - GET    /teams                           — my teams
 *     - GET    /teams/:teamId
 *     - POST   /teams                           — create team
 *     - PATCH  /teams/:teamId                   — update team
 *     - POST   /teams/:teamId/clone
 *     - DELETE /teams/:teamId                   — soft delete
 *     - POST   /teams/preview                   — live validation
 *     - GET    /drafts                          — my drafts for a match
 *     - PUT    /drafts                          — upsert (auto-save)
 *     - DELETE /drafts/:draftId
 *
 *   Admin (RBAC-guarded):
 *     - /admin/rules            — CRUD + activate
 *     - /admin/scoring-rules    — CRUD + activate
 */
const router = Router();

const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN] as const;

// ─── Match context ────────────────────────────────────────────────────
router.get(
  '/matches/:matchId/context',
  optionalAuth,
  validate({ params: fantasyMatchContextParamsSchema }),
  getFantasyMatchContextController,
);
router.get(
  '/matches/:matchId/rules',
  optionalAuth,
  validate({ params: fantasyMatchContextParamsSchema }),
  getFantasyMatchRuleController,
);

// ─── Teams (auth required) ────────────────────────────────────────────
router.get(
  '/teams',
  requireAuth,
  validate({ query: fantasyTeamListQuerySchema }),
  listMyFantasyTeamsController,
);
router.post(
  '/teams/preview',
  requireAuth,
  validate({ body: fantasyTeamPreviewBodySchema }),
  previewFantasyTeamController,
);
router.post(
  '/teams',
  requireAuth,
  validate({ body: fantasyTeamCreateBodySchema }),
  createFantasyTeamController,
);
router.get(
  '/teams/:teamId',
  requireAuth,
  validate({ params: fantasyTeamParamsSchema }),
  getMyFantasyTeamController,
);
router.patch(
  '/teams/:teamId',
  requireAuth,
  validate({ params: fantasyTeamParamsSchema, body: fantasyTeamUpdateBodySchema }),
  updateFantasyTeamController,
);
router.post(
  '/teams/:teamId/clone',
  requireAuth,
  validate({ params: fantasyTeamParamsSchema, body: fantasyTeamCloneBodySchema }),
  cloneFantasyTeamController,
);
router.delete(
  '/teams/:teamId',
  requireAuth,
  validate({ params: fantasyTeamParamsSchema }),
  deleteFantasyTeamController,
);

// ─── Drafts ───────────────────────────────────────────────────────────
router.get(
  '/drafts',
  requireAuth,
  validate({ query: fantasyDraftListQuerySchema }),
  listMyFantasyDraftsController,
);
router.put(
  '/drafts',
  requireAuth,
  validate({ body: fantasyDraftUpsertBodySchema }),
  upsertFantasyDraftController,
);
router.delete(
  '/drafts/:draftId',
  requireAuth,
  validate({ params: fantasyDraftParamsSchema }),
  deleteFantasyDraftController,
);

// ─── Admin — rules ────────────────────────────────────────────────────
router.get(
  '/admin/rules',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ query: fantasyRuleListQuerySchema }),
  adminListFantasyRulesController,
);
router.post(
  '/admin/rules',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ body: fantasyRuleCreateBodySchema }),
  adminCreateFantasyRuleController,
);
router.get(
  '/admin/rules/:ruleId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: fantasyRuleParamsSchema }),
  adminGetFantasyRuleController,
);
router.patch(
  '/admin/rules/:ruleId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: fantasyRuleParamsSchema, body: fantasyRuleUpdateBodySchema }),
  adminUpdateFantasyRuleController,
);
router.post(
  '/admin/rules/:ruleId/activate',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: fantasyRuleParamsSchema }),
  adminActivateFantasyRuleController,
);

// ─── Admin — scoring rules ────────────────────────────────────────────
router.get(
  '/admin/scoring-rules',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ query: fantasyScoringRuleListQuerySchema }),
  adminListFantasyScoringRulesController,
);
router.post(
  '/admin/scoring-rules',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ body: fantasyScoringRuleCreateBodySchema }),
  adminCreateFantasyScoringRuleController,
);
router.get(
  '/admin/scoring-rules/:ruleId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: fantasyScoringRuleParamsSchema }),
  adminGetFantasyScoringRuleController,
);
router.patch(
  '/admin/scoring-rules/:ruleId',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: fantasyScoringRuleParamsSchema, body: fantasyScoringRuleUpdateBodySchema }),
  adminUpdateFantasyScoringRuleController,
);
router.post(
  '/admin/scoring-rules/:ruleId/activate',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  validate({ params: fantasyScoringRuleParamsSchema }),
  adminActivateFantasyScoringRuleController,
);

export { router as fantasyRoutes };

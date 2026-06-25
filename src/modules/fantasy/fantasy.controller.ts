import type { Request, Response } from 'express';

import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors/AppError';
import { asyncHandler, sendCreated, sendNoContent, sendSuccess } from '@common/utils';
import { parsePagination } from '@common/utils/pagination.util';

import { Player } from '@modules/sports/player.model';
import { Team } from '@modules/sports/team.model';

import { fantasyDraftService } from './fantasy-draft.service';
import { fantasyMatchService } from './fantasy-match.service';
import { fantasyRuleService } from './fantasy-rule.service';
import { fantasyScoringRuleService } from './fantasy-scoring-rule.service';
import { fantasyTeamService } from './fantasy-team.service';
import {
  fantasyDraftSerializer,
  fantasyRuleSerializer,
  fantasyScoringRuleSerializer,
  fantasyTeamSerializer,
  type PlayerLookupMaps,
} from './fantasy.serializers';
import type {
  FantasyDraftListQuery,
  FantasyDraftParams,
  FantasyDraftUpsertBody,
  FantasyMatchContextParams,
  FantasyRuleCreateBody,
  FantasyRuleListQuery,
  FantasyRuleParams,
  FantasyRuleUpdateBody,
  FantasyScoringRuleCreateBody,
  FantasyScoringRuleListQuery,
  FantasyScoringRuleParams,
  FantasyScoringRuleUpdateBody,
  FantasyTeamCloneBody,
  FantasyTeamCreateBody,
  FantasyTeamListQuery,
  FantasyTeamParams,
  FantasyTeamPreviewBody,
  FantasyTeamUpdateBody,
} from './fantasy.validators';

/**
 * Fantasy controllers — thin HTTP layer.
 *
 * Each handler parses the validated request, calls the matching service,
 * and serialises the response. Business logic lives in services.
 */

const requireUser = (req: Request) => {
  if (!req.user) {
    throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  }
  return req.user;
};

const buildPlayerLookupMaps = async (
  teamDocs: Array<{ players: Array<{ playerId: unknown; teamId: unknown }> }>,
): Promise<PlayerLookupMaps> => {
  const playerIds = new Set<string>();
  const teamIds = new Set<string>();
  for (const team of teamDocs) {
    for (const player of team.players) {
      playerIds.add(String(player.playerId));
      teamIds.add(String(player.teamId));
    }
  }
  const [players, teams] = await Promise.all([
    playerIds.size ? Player.find({ _id: { $in: [...playerIds] } }).exec() : Promise.resolve([]),
    teamIds.size ? Team.find({ _id: { $in: [...teamIds] } }).exec() : Promise.resolve([]),
  ]);
  return {
    players: new Map(players.map((p) => [String(p._id), p])),
    teams: new Map(teams.map((t) => [String(t._id), t])),
  };
};

// ─── Match context (player listing) ───────────────────────────────────

export const getFantasyMatchContextController = asyncHandler(
  async (req: Request, res: Response) => {
    const { matchId } = req.params as unknown as FantasyMatchContextParams;
    const dto = await fantasyMatchService.getContext(matchId);
    sendSuccess(res, dto);
  },
);

// ─── Active rule / scoring rule lookups for a match ───────────────────

export const getFantasyMatchRuleController = asyncHandler(
  async (req: Request, res: Response) => {
    const { matchId } = req.params as unknown as FantasyMatchContextParams;
    const ctx = await fantasyMatchService.getContext(matchId);
    sendSuccess(res, { rule: ctx.rule, scoringRule: ctx.scoringRule });
  },
);

// ─── Teams (user) ─────────────────────────────────────────────────────

export const listMyFantasyTeamsController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const query = req.query as unknown as FantasyTeamListQuery;
  const pagination = parsePagination(query);
  const result = await fantasyTeamService.list(
    { userId: user.id },
    { ...pagination, matchId: query.matchId },
  );
  const maps = await buildPlayerLookupMaps(result.items);
  sendSuccess(
    res,
    result.items.map((doc) => fantasyTeamSerializer.toDTO(doc, maps)),
    { meta: result.meta as unknown as Record<string, unknown> },
  );
});

export const getMyFantasyTeamController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { teamId } = req.params as unknown as FantasyTeamParams;
  const team = await fantasyTeamService.getById({ userId: user.id }, teamId);
  const maps = await buildPlayerLookupMaps([team]);
  sendSuccess(res, fantasyTeamSerializer.toDTO(team, maps));
});

export const createFantasyTeamController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const body = req.body as FantasyTeamCreateBody;
  const team = await fantasyTeamService.create({ userId: user.id }, body, user.roles);
  const maps = await buildPlayerLookupMaps([team]);
  sendCreated(res, fantasyTeamSerializer.toDTO(team, maps));
});

export const updateFantasyTeamController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { teamId } = req.params as unknown as FantasyTeamParams;
  const body = req.body as FantasyTeamUpdateBody;
  const team = await fantasyTeamService.update({ userId: user.id }, teamId, body, user.roles);
  const maps = await buildPlayerLookupMaps([team]);
  sendSuccess(res, fantasyTeamSerializer.toDTO(team, maps));
});

export const cloneFantasyTeamController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { teamId } = req.params as unknown as FantasyTeamParams;
  const body = req.body as FantasyTeamCloneBody;
  const team = await fantasyTeamService.clone({ userId: user.id }, teamId, body, user.roles);
  const maps = await buildPlayerLookupMaps([team]);
  sendCreated(res, fantasyTeamSerializer.toDTO(team, maps));
});

export const deleteFantasyTeamController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { teamId } = req.params as unknown as FantasyTeamParams;
  await fantasyTeamService.delete({ userId: user.id }, teamId, user.roles);
  sendNoContent(res);
});

export const previewFantasyTeamController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const body = req.body as FantasyTeamPreviewBody;
  const result = await fantasyTeamService.preview({ userId: user.id }, body);
  sendSuccess(res, result);
});

// ─── Drafts ───────────────────────────────────────────────────────────

export const listMyFantasyDraftsController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const { matchId } = req.query as unknown as FantasyDraftListQuery;
    const drafts = await fantasyDraftService.list({ userId: user.id }, matchId);
    sendSuccess(res, drafts.map((d) => fantasyDraftSerializer.toDTO(d)));
  },
);

export const upsertFantasyDraftController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const body = req.body as FantasyDraftUpsertBody;
  const draft = await fantasyDraftService.upsert({ userId: user.id }, body);
  sendSuccess(res, fantasyDraftSerializer.toDTO(draft));
});

export const deleteFantasyDraftController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { draftId } = req.params as unknown as FantasyDraftParams;
  await fantasyDraftService.deleteById({ userId: user.id }, draftId);
  sendNoContent(res);
});

// ─── Admin — fantasy rules ────────────────────────────────────────────

export const adminListFantasyRulesController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const query = req.query as unknown as FantasyRuleListQuery;
    const result = await fantasyRuleService.list(query);
    sendSuccess(
      res,
      result.items.map((doc) => fantasyRuleSerializer.toDTO(doc)),
      { meta: result.meta as unknown as Record<string, unknown> },
    );
    void user;
  },
);

export const adminGetFantasyRuleController = asyncHandler(async (req: Request, res: Response) => {
  const { ruleId } = req.params as unknown as FantasyRuleParams;
  const rule = await fantasyRuleService.getById(ruleId);
  sendSuccess(res, fantasyRuleSerializer.toDTO(rule));
});

export const adminCreateFantasyRuleController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const body = req.body as FantasyRuleCreateBody;
    const rule = await fantasyRuleService.create(body, {
      actorId: user.id,
      actorRoles: user.roles,
    });
    sendCreated(res, fantasyRuleSerializer.toDTO(rule));
  },
);

export const adminUpdateFantasyRuleController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const { ruleId } = req.params as unknown as FantasyRuleParams;
    const body = req.body as FantasyRuleUpdateBody;
    const rule = await fantasyRuleService.update(ruleId, body, {
      actorId: user.id,
      actorRoles: user.roles,
    });
    sendSuccess(res, fantasyRuleSerializer.toDTO(rule));
  },
);

export const adminActivateFantasyRuleController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const { ruleId } = req.params as unknown as FantasyRuleParams;
    const rule = await fantasyRuleService.activate(ruleId, {
      actorId: user.id,
      actorRoles: user.roles,
    });
    sendSuccess(res, fantasyRuleSerializer.toDTO(rule));
  },
);

// ─── Admin — scoring rules ────────────────────────────────────────────

export const adminListFantasyScoringRulesController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = req.query as unknown as FantasyScoringRuleListQuery;
    const result = await fantasyScoringRuleService.list(query);
    sendSuccess(
      res,
      result.items.map((doc) => fantasyScoringRuleSerializer.toDTO(doc)),
      { meta: result.meta as unknown as Record<string, unknown> },
    );
  },
);

export const adminGetFantasyScoringRuleController = asyncHandler(
  async (req: Request, res: Response) => {
    const { ruleId } = req.params as unknown as FantasyScoringRuleParams;
    const rule = await fantasyScoringRuleService.getById(ruleId);
    sendSuccess(res, fantasyScoringRuleSerializer.toDTO(rule));
  },
);

export const adminCreateFantasyScoringRuleController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const body = req.body as FantasyScoringRuleCreateBody;
    const rule = await fantasyScoringRuleService.create(body, {
      actorId: user.id,
      actorRoles: user.roles,
    });
    sendCreated(res, fantasyScoringRuleSerializer.toDTO(rule));
  },
);

export const adminUpdateFantasyScoringRuleController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const { ruleId } = req.params as unknown as FantasyScoringRuleParams;
    const body = req.body as FantasyScoringRuleUpdateBody;
    const rule = await fantasyScoringRuleService.update(ruleId, body, {
      actorId: user.id,
      actorRoles: user.roles,
    });
    sendSuccess(res, fantasyScoringRuleSerializer.toDTO(rule));
  },
);

export const adminActivateFantasyScoringRuleController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const { ruleId } = req.params as unknown as FantasyScoringRuleParams;
    const rule = await fantasyScoringRuleService.activate(ruleId, {
      actorId: user.id,
      actorRoles: user.roles,
    });
    sendSuccess(res, fantasyScoringRuleSerializer.toDTO(rule));
  },
);

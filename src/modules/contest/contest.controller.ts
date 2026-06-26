import type { Request, Response } from 'express';
import type { HydratedDocument } from 'mongoose';

import { AppConstants, ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';
import { asyncHandler, sendCreated, sendSuccess } from '@common/utils';

import { FantasyTeam, type IFantasyTeam } from '@modules/fantasy/fantasy-team.model';
import { Team, type ITeam } from '@modules/sports/team.model';

import { Contest, type ContestDoc } from './contest.model';
import { contestEntryRepository } from './contest-entry.repository';
import {
  contestEntrySerializer,
  contestSerializer,
  prizeDistributionSerializer,
  contestTemplateSerializer,
} from './contest.serializers';
import { contestService } from './contest.service';
import { contestTemplateService } from './contest-template.service';
import { prizeDistributionService } from './prize-distribution.service';
import { contestJoinService } from './contest-join.service';
import type {
  AdminContestCancelBody,
  AdminContestCreateBody,
  AdminContestFromTemplateBody,
  AdminContestListQuery,
  AdminContestStatusBody,
  AdminContestUpdateBody,
  ContestCloneBody,
  ContestEntryListQuery,
  ContestEntryParams,
  ContestInviteCodeQuery,
  ContestJoinBody,
  ContestListQuery,
  ContestParams,
  ContestTemplateCreateBody,
  ContestTemplateListQuery,
  ContestTemplateParams,
  ContestTemplateUpdateBody,
  PrizeDistributionCreateBody,
  PrizeDistributionListQuery,
  PrizeDistributionParams,
  PrizeDistributionUpdateBody,
} from './contest.validators';

/**
 * Contest module controllers — thin HTTP layer.
 *
 * Each handler validates auth, parses the typed request, calls the
 * matching service, and serialises the response. Business logic lives
 * in the services.
 */

const requireUser = (req: Request) => {
  if (!req.user) {
    throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  }
  return req.user;
};

const actorOf = (req: Request, opts: { allowAnonymous?: boolean } = {}) => {
  const user = opts.allowAnonymous ? req.user : requireUser(req);
  return {
    id: user?.id ?? null,
    roles: user?.roles ?? [],
    req,
  };
};

// ─── Match-context loader for serializer hydration ───────────────────

const hydrateContestDoc = async (
  doc: ContestDoc,
  userId: string | null,
): Promise<ReturnType<typeof contestSerializer.toDTO>> => {
  const match = await contestService
    .loadMatches([doc.matchId])
    .then((m) => m.get(String(doc.matchId)) ?? null);

  let homeTeam: HydratedDocument<ITeam> | null = null;
  let awayTeam: HydratedDocument<ITeam> | null = null;
  if (match) {
    const ids = [match.homeTeamId, match.awayTeamId].map(String);
    const teams = await Team.find({ _id: { $in: ids } }).exec();
    const map = new Map(teams.map((t) => [String(t._id), t]));
    homeTeam = map.get(String(match.homeTeamId)) ?? null;
    awayTeam = map.get(String(match.awayTeamId)) ?? null;
  }

  const myActiveEntryCount = userId
    ? await contestEntryRepository.countActiveForUserInContest(doc._id, userId)
    : null;

  return contestSerializer.toDTO(doc, { match, homeTeam, awayTeam, myActiveEntryCount });
};

// ─── User-facing contests ────────────────────────────────────────────

export const listContestsController = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ContestListQuery;
  const result = await contestService.listForUser(query);
  sendSuccess(
    res,
    result.items.map((c) => contestSerializer.toSummary(c)),
    { meta: result.meta as unknown as Record<string, unknown> },
  );
});

export const getContestController = asyncHandler(async (req: Request, res: Response) => {
  const { contestId } = req.params as unknown as ContestParams;
  const contest = await contestService.getById(contestId);
  const dto = await hydrateContestDoc(contest, req.user?.id ?? null);
  sendSuccess(res, dto);
});

export const lookupContestByInviteCodeController = asyncHandler(
  async (req: Request, res: Response) => {
    const { code } = req.query as unknown as ContestInviteCodeQuery;
    const contest = await contestService.getByInviteCode(code);
    const dto = await hydrateContestDoc(contest, req.user?.id ?? null);
    sendSuccess(res, dto);
  },
);

// ─── Join flow ───────────────────────────────────────────────────────

export const joinContestController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { contestId } = req.params as unknown as ContestParams;
  const body = req.body as ContestJoinBody;
  const headerIdempotency = req.header(AppConstants.IDEMPOTENCY_KEY_HEADER);

  const result = await contestJoinService.join({
    contestId,
    teamId: body.teamId,
    userId: user.id,
    inviteCode: body.inviteCode ?? null,
    idempotencyKey: body.idempotencyKey ?? headerIdempotency ?? null,
    req,
  });

  const [entryDoc, contestDoc, wallet] = await Promise.all([
    Promise.resolve(result.entry),
    Promise.resolve(result.contest as ContestDoc),
    contestJoinService.getWalletSnapshotForUser(user.id),
  ]);

  const team = await FantasyTeam.findById(entryDoc.teamId).exec();
  sendCreated(res, {
    entry: contestEntrySerializer.toDTO(entryDoc, { team, contest: contestDoc }),
    contest: contestSerializer.toSummary(contestDoc),
    wallet,
  });
});

// ─── User entries / my contests ──────────────────────────────────────

export const listMyContestEntriesController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const query = req.query as unknown as ContestEntryListQuery;

    const result = await contestEntryRepository.list(
      {
        userId: user.id,
        contestId: query.contestId,
        matchId: query.matchId,
        status: query.status,
      },
      {
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder ?? 'desc',
      },
    );

    // Bulk-load contests + teams for serializer hydration.
    const contestIds = Array.from(new Set(result.items.map((e) => String(e.contestId))));
    const teamIds = Array.from(new Set(result.items.map((e) => String(e.teamId))));
    const [contests, teams] = await Promise.all([
      contestIds.length
        ? Contest.find({ _id: { $in: contestIds } }).exec()
        : Promise.resolve([] as ContestDoc[]),
      teamIds.length ? FantasyTeam.find({ _id: { $in: teamIds } }).exec() : Promise.resolve([]),
    ]);
    const contestMap = new Map<string, ContestDoc>(
      contests.map((c) => [String(c._id), c]),
    );
    const teamMap = new Map<string, HydratedDocument<IFantasyTeam>>(
      teams.map((t) => [String(t._id), t]),
    );

    sendSuccess(
      res,
      result.items.map((entry) =>
        contestEntrySerializer.toDTO(entry, {
          team: teamMap.get(String(entry.teamId)) ?? null,
          contest: contestMap.get(String(entry.contestId)) ?? null,
        }),
      ),
      { meta: result.meta as unknown as Record<string, unknown> },
    );
  },
);

export const getMyContestEntryController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { entryId } = req.params as unknown as ContestEntryParams;
  const entry = await contestEntryRepository.findById(entryId);
  if (!entry || String(entry.userId) !== user.id) {
    throw new AppError('Entry not found', HttpStatus.NOT_FOUND, ErrorCode.CONTEST_ENTRY_NOT_FOUND);
  }
  const [contest, team] = await Promise.all([
    contestService.getById(String(entry.contestId)),
    FantasyTeam.findById(entry.teamId).exec(),
  ]);
  sendSuccess(res, contestEntrySerializer.toDTO(entry, { contest, team }));
});

/** List the caller's entries inside a single contest — drives the
 *  "Joined teams" panel on the contest detail screen. */
export const listMyEntriesForContestController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const { contestId } = req.params as unknown as ContestParams;
    const entries = await contestEntryRepository.findForUserInContest(contestId, user.id);
    const teams = entries.length
      ? await FantasyTeam.find({ _id: { $in: entries.map((e) => e.teamId) } }).exec()
      : [];
    const teamMap = new Map<string, HydratedDocument<IFantasyTeam>>(
      teams.map((t) => [String(t._id), t]),
    );
    sendSuccess(
      res,
      entries.map((e) =>
        contestEntrySerializer.toDTO(e, {
          team: teamMap.get(String(e.teamId)) ?? null,
        }),
      ),
    );
  },
);

// ─── Admin — contests ────────────────────────────────────────────────

export const adminListContestsController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = req.query as unknown as AdminContestListQuery;
    const result = await contestService.listForAdmin(query);
    sendSuccess(
      res,
      result.items.map((c) => contestSerializer.toSummary(c)),
      { meta: result.meta as unknown as Record<string, unknown> },
    );
  },
);

export const adminGetContestController = asyncHandler(async (req: Request, res: Response) => {
  const { contestId } = req.params as unknown as ContestParams;
  const contest = await contestService.getById(contestId);
  const dto = await hydrateContestDoc(contest, null);
  sendSuccess(res, dto);
});

export const adminCreateContestController = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const body = req.body as AdminContestCreateBody;
    const contest = await contestService.createContest(body, actor);
    const dto = await hydrateContestDoc(contest, null);
    sendCreated(res, dto);
  },
);

export const adminCreateContestsFromTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const body = req.body as AdminContestFromTemplateBody;
    const result = await contestService.createContestsFromTemplate(body, actor);
    sendCreated(res, {
      items: result.created.map((c) => contestSerializer.toSummary(c)),
      skippedMatchIds: result.skippedMatchIds,
    });
  },
);

export const adminUpdateContestController = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const { contestId } = req.params as unknown as ContestParams;
    const body = req.body as AdminContestUpdateBody;
    const contest = await contestService.updateContest(contestId, body, actor);
    const dto = await hydrateContestDoc(contest, null);
    sendSuccess(res, dto);
  },
);

export const adminCloneContestController = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const { contestId } = req.params as unknown as ContestParams;
    const body = req.body as ContestCloneBody;
    const contests = await contestService.cloneContest(contestId, body, actor);
    sendCreated(res, contests.map((c) => contestSerializer.toSummary(c)));
  },
);

export const adminTransitionContestStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const { contestId } = req.params as unknown as ContestParams;
    const { status } = req.body as AdminContestStatusBody;
    const contest = await contestService.transitionStatus(contestId, status, actor);
    sendSuccess(res, contestSerializer.toSummary(contest));
  },
);

export const adminCancelContestController = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const { contestId } = req.params as unknown as ContestParams;
    const { reason } = req.body as AdminContestCancelBody;
    const contest = await contestService.cancelContest(
      contestId,
      reason,
      actor,
      (entries, ctxContestId) =>
        contestJoinService.refundAllEntries(entries, ctxContestId),
    );
    sendSuccess(res, contestSerializer.toSummary(contest));
  },
);

export const adminListContestEntriesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { contestId } = req.params as unknown as ContestParams;
    const query = req.query as unknown as ContestEntryListQuery;
    const result = await contestEntryRepository.list(
      {
        contestId,
        status: query.status,
      },
      {
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder ?? 'desc',
      },
    );

    const teamIds = Array.from(new Set(result.items.map((e) => String(e.teamId))));
    const teams = teamIds.length
      ? await FantasyTeam.find({ _id: { $in: teamIds } }).exec()
      : [];
    const teamMap = new Map<string, HydratedDocument<IFantasyTeam>>(
      teams.map((t) => [String(t._id), t]),
    );

    sendSuccess(
      res,
      result.items.map((e) =>
        contestEntrySerializer.toDTO(e, {
          team: teamMap.get(String(e.teamId)) ?? null,
        }),
      ),
      { meta: result.meta as unknown as Record<string, unknown> },
    );
  },
);

// ─── Admin — templates ───────────────────────────────────────────────

export const adminListContestTemplatesController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = req.query as unknown as ContestTemplateListQuery;
    const result = await contestTemplateService.list(query);
    sendSuccess(
      res,
      result.items.map((t) => contestTemplateSerializer.toDTO(t)),
      { meta: result.meta as unknown as Record<string, unknown> },
    );
  },
);

export const adminGetContestTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const { templateId } = req.params as unknown as ContestTemplateParams;
    const doc = await contestTemplateService.getById(templateId);
    sendSuccess(res, contestTemplateSerializer.toDTO(doc));
  },
);

export const adminCreateContestTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const body = req.body as ContestTemplateCreateBody;
    const doc = await contestTemplateService.create(body, actor);
    sendCreated(res, contestTemplateSerializer.toDTO(doc));
  },
);

export const adminUpdateContestTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const { templateId } = req.params as unknown as ContestTemplateParams;
    const body = req.body as ContestTemplateUpdateBody;
    const doc = await contestTemplateService.update(templateId, body, actor);
    sendSuccess(res, contestTemplateSerializer.toDTO(doc));
  },
);

export const adminDeleteContestTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const { templateId } = req.params as unknown as ContestTemplateParams;
    await contestTemplateService.delete(templateId, actor);
    sendSuccess(res, { deleted: true });
  },
);

// ─── Admin — prize distributions ─────────────────────────────────────

export const adminListPrizeDistributionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = req.query as unknown as PrizeDistributionListQuery;
    const result = await prizeDistributionService.list(query);
    sendSuccess(
      res,
      result.items.map((d) => prizeDistributionSerializer.toDTO(d)),
      { meta: result.meta as unknown as Record<string, unknown> },
    );
  },
);

export const adminGetPrizeDistributionController = asyncHandler(
  async (req: Request, res: Response) => {
    const { distributionId } = req.params as unknown as PrizeDistributionParams;
    const doc = await prizeDistributionService.getById(distributionId);
    sendSuccess(res, prizeDistributionSerializer.toDTO(doc));
  },
);

export const adminCreatePrizeDistributionController = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const body = req.body as PrizeDistributionCreateBody;
    const doc = await prizeDistributionService.create(body, actor);
    sendCreated(res, prizeDistributionSerializer.toDTO(doc));
  },
);

export const adminUpdatePrizeDistributionController = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const { distributionId } = req.params as unknown as PrizeDistributionParams;
    const body = req.body as PrizeDistributionUpdateBody;
    const doc = await prizeDistributionService.update(distributionId, body, actor);
    sendSuccess(res, prizeDistributionSerializer.toDTO(doc));
  },
);

export const adminDeletePrizeDistributionController = asyncHandler(
  async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const { distributionId } = req.params as unknown as PrizeDistributionParams;
    await prizeDistributionService.delete(distributionId, actor);
    sendSuccess(res, { deleted: true });
  },
);

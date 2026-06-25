import type { Request, Response } from 'express';

import { asyncHandler, sendSuccess } from '@common/utils';
import { parsePagination } from '@common/utils/pagination.util';

import { matchService } from './match.service';
import { playerService } from './player.service';
import { teamService } from './team.service';
import { tournamentService } from './tournament.service';
import { sportsAdminService } from './sports-admin.service';
import type {
  AdminCacheFlushBody,
  AdminCancelMatchBody,
  AdminFeatureBody,
  AdminSyncBody,
  MatchListQuery,
  MatchParams,
  MatchUpdatesQuery,
  PlayerListQuery,
  PlayerParams,
  TeamListQuery,
  TeamParams,
  TournamentListQuery,
  TournamentParams,
} from './sports.validators';

/**
 * Sports controllers — thin HTTP layer.
 *
 * Each handler unpacks the validated request, calls into the matching
 * service, and wraps the response in the standard envelope.
 * NEVER add business logic here.
 */

// ─── Matches (public) ─────────────────────────────────────────────────────

export const listMatchesController = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as MatchListQuery;
  const pagination = parsePagination(query);
  const result = await matchService.listMatches(
    {
      sport: query.sport,
      status: query.status,
      tournamentId: query.tournamentId,
      teamId: query.teamId,
      featured: query.featured,
      from: query.from,
      to: query.to,
      q: query.q,
    },
    pagination,
  );
  return sendSuccess(res, result.items, { meta: result.meta });
});

export const listLiveMatchesController = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as MatchListQuery;
  const items = await matchService.listLive(query.sport, query.limit);
  return sendSuccess(res, items);
});

export const listUpcomingMatchesController = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as MatchListQuery;
  const items = await matchService.listUpcoming(query.sport, query.limit);
  return sendSuccess(res, items);
});

export const listFeaturedMatchesController = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as MatchListQuery;
  const items = await matchService.listFeatured(query.sport);
  return sendSuccess(res, items);
});

export const listTrendingMatchesController = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as MatchListQuery;
  const items = await matchService.listTrending(query.sport);
  return sendSuccess(res, items);
});

export const getMatchController = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params as unknown as MatchParams;
  const match = await matchService.getMatch(matchId);
  return sendSuccess(res, match);
});

export const getMatchUpdatesController = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params as unknown as MatchParams;
  const query = req.query as unknown as MatchUpdatesQuery;
  const updates = await matchService.listUpdates(matchId, query.sinceSequence, query.limit);
  return sendSuccess(res, updates);
});

export const getMatchPlayersController = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params as unknown as MatchParams;
  const stats = await matchService.listPlayerStatsForMatch(matchId);
  return sendSuccess(res, stats);
});

// ─── Tournaments / Teams / Players (public) ───────────────────────────────

export const listTournamentsController = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as TournamentListQuery;
  const pagination = parsePagination(query);
  const { items, meta } = await tournamentService.list(
    { sport: query.sport, status: query.status, q: query.q },
    pagination,
  );
  return sendSuccess(res, items, { meta });
});

export const getTournamentController = asyncHandler(async (req: Request, res: Response) => {
  const { tournamentId } = req.params as unknown as TournamentParams;
  const tournament = await tournamentService.getById(tournamentId);
  return sendSuccess(res, tournament);
});

export const listTeamsController = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as TeamListQuery;
  const pagination = parsePagination(query);
  const { items, meta } = await teamService.list({ sport: query.sport, q: query.q }, pagination);
  return sendSuccess(res, items, { meta });
});

export const getTeamController = asyncHandler(async (req: Request, res: Response) => {
  const { teamId } = req.params as unknown as TeamParams;
  const team = await teamService.getProfile(teamId);
  return sendSuccess(res, team);
});

export const getTeamRosterController = asyncHandler(async (req: Request, res: Response) => {
  const { teamId } = req.params as unknown as TeamParams;
  const roster = await teamService.listRoster(teamId);
  return sendSuccess(res, roster);
});

export const listPlayersController = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as PlayerListQuery;
  const pagination = parsePagination(query);
  const { items, meta } = await playerService.list(
    { sport: query.sport, role: query.role, teamId: query.teamId, q: query.q },
    pagination,
  );
  return sendSuccess(res, items, { meta });
});

export const getPlayerController = asyncHandler(async (req: Request, res: Response) => {
  const { playerId } = req.params as unknown as PlayerParams;
  const player = await playerService.getProfile(playerId);
  return sendSuccess(res, player);
});

export const getPlayerStatsController = asyncHandler(async (req: Request, res: Response) => {
  const { playerId } = req.params as unknown as PlayerParams;
  const pagination = parsePagination(req.query as Record<string, unknown>);
  const { items, meta } = await playerService.listRecentStats(playerId, pagination);
  return sendSuccess(res, items, { meta });
});

// ─── Admin controllers ────────────────────────────────────────────────────

export const adminSyncController = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as AdminSyncBody;
  const report = await sportsAdminService.triggerSync(body, req);
  return sendSuccess(res, report);
});

export const adminFeatureMatchController = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params as unknown as MatchParams;
  const { isFeatured } = req.body as AdminFeatureBody;
  await sportsAdminService.setFeatured(matchId, isFeatured, req);
  return sendSuccess(res, { matchId, isFeatured });
});

export const adminCancelMatchController = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params as unknown as MatchParams;
  const { reason } = req.body as AdminCancelMatchBody;
  await sportsAdminService.cancelMatch(matchId, reason, req);
  return sendSuccess(res, { matchId, status: 'CANCELLED' });
});

export const adminFlushCacheController = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as AdminCacheFlushBody;
  const result = await sportsAdminService.flushCache(body, req);
  return sendSuccess(res, result);
});

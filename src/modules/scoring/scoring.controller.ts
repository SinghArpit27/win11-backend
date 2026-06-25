import type { Request, Response } from 'express';

import { ErrorCode, HttpStatus } from '@common/constants';
import { ScoreEventType } from '@common/enums';
import { AppError } from '@common/errors';
import { asyncHandler, sendSuccess } from '@common/utils';

import { fantasyPointsRepository } from './fantasy-points.repository';
import { scoreEventRepository } from './score-event.repository';
import { fantasyPointsSerializer, scoreEventSerializer } from './scoring.serializers';
import { scoringService } from './scoring.service';
import type {
  AdjustPlayerPointsBody,
  ListScoreEventsQuery,
  MatchIdParam,
  MatchPlayerParam,
  RecomputeMatchBody,
} from './scoring.validators';

/**
 * Scoring HTTP layer.
 *
 * User-facing reads:
 *   - GET /matches/:matchId/fantasy-points         — all players
 *   - GET /matches/:matchId/players/:playerId/fantasy-points
 *
 * Admin actions:
 *   - POST /admin/scoring/matches/:matchId/recompute
 *   - POST /admin/scoring/matches/:matchId/players/:playerId/adjust
 *   - GET  /admin/scoring/matches/:matchId/events
 *   - GET  /admin/scoring/matches/:matchId/status
 */

const requireUser = (req: Request) => {
  if (!req.user) {
    throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  }
  return req.user;
};

// ─── USER ROUTES ────────────────────────────────────────────────────

export const getMatchFantasyPointsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { matchId } = req.params as unknown as MatchIdParam;
    const rows = await fantasyPointsRepository.findForMatch(matchId);
    sendSuccess(res, {
      matchId,
      players: rows.map((r) => fantasyPointsSerializer.toDTO(r)),
    });
  },
);

export const getPlayerFantasyPointsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { matchId, playerId } = req.params as unknown as MatchPlayerParam;
    const row = await fantasyPointsRepository.findForPlayerInMatch(matchId, playerId);
    if (!row) {
      sendSuccess(res, { matchId, playerId, points: null });
      return;
    }
    sendSuccess(res, {
      matchId,
      playerId,
      points: fantasyPointsSerializer.toDTO(row),
    });
  },
);

// ─── ADMIN ROUTES ───────────────────────────────────────────────────

export const adminRecomputeMatchController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const { matchId } = req.params as unknown as MatchIdParam;
    const body = req.body as RecomputeMatchBody;
    const result = await scoringService.recomputeForMatch({
      matchId,
      type: (body.type as ScoreEventType) ?? ScoreEventType.MANUAL_RECOMPUTE,
      triggeredBy: user.id,
      context: body.reason ? { reason: body.reason } : undefined,
    });
    sendSuccess(res, result);
  },
);

export const adminAdjustPlayerPointsController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const { matchId, playerId } = req.params as unknown as MatchPlayerParam;
    const body = req.body as AdjustPlayerPointsBody;
    await scoringService.adjustPlayerPoints({
      matchId,
      playerId,
      delta: body.delta,
      reason: body.reason,
      actorId: user.id,
    });
    sendSuccess(res, { matchId, playerId, delta: body.delta });
  },
);

export const adminListScoreEventsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { matchId } = req.params as unknown as MatchIdParam;
    const query = req.query as unknown as ListScoreEventsQuery;
    const rows = await scoreEventRepository.findRecentForMatch(matchId, query.limit);
    sendSuccess(res, {
      matchId,
      events: rows.map((r) => scoreEventSerializer.toDTO(r)),
    });
  },
);

export const adminGetScoringStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const { matchId } = req.params as unknown as MatchIdParam;
    const [canScore, latest] = await Promise.all([
      scoringService.canScoreMatch(matchId),
      scoreEventRepository.findLatestCompleted(matchId),
    ]);
    sendSuccess(res, {
      matchId,
      canScore: canScore.ok,
      reason: canScore.reason ?? null,
      latestEvent: latest ? scoreEventSerializer.toDTO(latest) : null,
    });
  },
);

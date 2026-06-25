import type { Request, Response } from 'express';

import { ErrorCode, HttpStatus } from '@common/constants';
import { LeaderboardScope, LeaderboardSnapshotReason } from '@common/enums';
import { AppError } from '@common/errors';
import { asyncHandler, sendSuccess } from '@common/utils';

import { contestSettlementService } from '@modules/settlement/contest-settlement.service';

import { contestResultRepository } from './contest-result.repository';
import { leaderboardSnapshotRepository } from './leaderboard-snapshot.repository';
import { leaderboardService } from './leaderboard.service';
import { rankHistoryRepository } from './rank-history.repository';
import {
  contestResultSerializer,
  leaderboardSnapshotSerializer,
  rankHistorySerializer,
} from './leaderboard.serializers';
import type {
  ContestIdParam,
  LeaderboardPageQuery,
  RankHistoryQuery,
  RebuildLeaderboardBody,
  SettleContestBody,
} from './leaderboard.validators';

/**
 * Leaderboard HTTP layer — thin async handlers around the service.
 */

const requireUser = (req: Request) => {
  if (!req.user) {
    throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  }
  return req.user;
};

// ─── USER ROUTES ────────────────────────────────────────────────────

export const getContestLeaderboardController = asyncHandler(
  async (req: Request, res: Response) => {
    const { contestId } = req.params as unknown as ContestIdParam;
    const query = req.query as unknown as LeaderboardPageQuery;
    const page = await leaderboardService.getContestPage({
      contestId,
      page: query.page,
      pageSize: query.limit,
      userId: req.user?.id ?? null,
    });
    sendSuccess(res, page);
  },
);

export const getMyContestRankController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { contestId } = req.params as unknown as ContestIdParam;
  const rank = await leaderboardService.getUserRank({ contestId, userId: user.id });
  sendSuccess(res, { rank });
});

export const getMyRankHistoryController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { contestId } = req.params as unknown as ContestIdParam;
  const query = req.query as unknown as RankHistoryQuery;
  const history = await leaderboardService.getRankHistory({
    contestId,
    userId: user.id,
    limit: query.limit,
  });
  sendSuccess(res, { history });
});

export const getContestResultController = asyncHandler(async (req: Request, res: Response) => {
  const { contestId } = req.params as unknown as ContestIdParam;
  const contestObj = await contestSettlementService.getResult(contestId);
  const result = contestObj.result ? contestResultSerializer.toDTO(contestObj.result) : null;
  sendSuccess(res, { contestId, result });
});

export const getMyRecentRankHistoryController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const limit = req.query?.limit ? Number(req.query.limit) : 25;
    const rows = await rankHistoryRepository.findUserRecentHistory(user.id, limit);
    sendSuccess(res, { history: rows.map((r) => rankHistorySerializer.toDTO(r)) });
  },
);

// ─── ADMIN ROUTES ───────────────────────────────────────────────────

export const adminRebuildLeaderboardController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const { contestId } = req.params as unknown as ContestIdParam;
    const body = req.body as RebuildLeaderboardBody;
    const result = await leaderboardService.rebuildForContest({
      contestId,
      reason: (body.reason ?? 'MANUAL') as LeaderboardSnapshotReason,
      triggeredBy: user.id,
    });
    sendSuccess(res, result);
  },
);

export const adminListSnapshotsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { contestId } = req.params as unknown as ContestIdParam;
    const limit = req.query?.limit ? Number(req.query.limit) : 20;
    const rows = await leaderboardSnapshotRepository.listForScope(
      LeaderboardScope.CONTEST,
      contestId,
      limit,
    );
    sendSuccess(res, { snapshots: rows.map((r) => leaderboardSnapshotSerializer.toDTO(r)) });
  },
);

export const adminSettleContestController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const { contestId } = req.params as unknown as ContestIdParam;
    const body = req.body as SettleContestBody;
    const summary = await contestSettlementService.settleContest({
      contestId,
      actorId: user.id,
      force: body.force ?? false,
    });
    sendSuccess(res, summary);
  },
);

export const adminResetSettlementController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);
    const { contestId } = req.params as unknown as ContestIdParam;
    await contestSettlementService.resetForRetry(contestId, user.id);
    sendSuccess(res, { contestId, status: 'NOT_STARTED' });
  },
);

export const adminGetSettlementController = asyncHandler(
  async (req: Request, res: Response) => {
    const { contestId } = req.params as unknown as ContestIdParam;
    const result = await contestResultRepository.findByContestId(contestId);
    sendSuccess(res, {
      contestId,
      result: result ? contestResultSerializer.toDTO(result) : null,
    });
  },
);

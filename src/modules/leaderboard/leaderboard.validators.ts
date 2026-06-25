import { z } from 'zod';

import { AppConstants } from '@common/constants';
import { objectIdString } from '@common/validators';

/**
 * Zod schemas for the leaderboard HTTP layer.
 */

const objectIdParam = objectIdString;

export const contestIdParamSchema = z.object({
  contestId: objectIdParam('contestId'),
});
export type ContestIdParam = z.infer<typeof contestIdParamSchema>;

export const matchIdParamSchema = z.object({
  matchId: objectIdParam('matchId'),
});
export type MatchIdParam = z.infer<typeof matchIdParamSchema>;

export const leaderboardPageQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(AppConstants.LEADERBOARD.MAX_PAGE_SIZE)
    .default(AppConstants.LEADERBOARD.DEFAULT_PAGE_SIZE),
});
export type LeaderboardPageQuery = z.infer<typeof leaderboardPageQuerySchema>;

export const rankHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type RankHistoryQuery = z.infer<typeof rankHistoryQuerySchema>;

export const userRankingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(AppConstants.LEADERBOARD.MAX_PAGE_SIZE)
    .default(AppConstants.LEADERBOARD.MY_RANKINGS_PAGE_SIZE),
});
export type UserRankingsQuery = z.infer<typeof userRankingsQuerySchema>;

// ─── Admin actions ───────────────────────────────────────────────────

export const rebuildLeaderboardBodySchema = z.object({
  reason: z.enum(['MANUAL', 'PERIODIC', 'LIVE_TICK', 'FINAL']).default('MANUAL'),
});
export type RebuildLeaderboardBody = z.infer<typeof rebuildLeaderboardBodySchema>;

export const settleContestBodySchema = z.object({
  force: z.boolean().default(false),
});
export type SettleContestBody = z.infer<typeof settleContestBodySchema>;

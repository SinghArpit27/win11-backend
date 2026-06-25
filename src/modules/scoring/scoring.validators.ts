import { z } from 'zod';

import { ScoreEventType } from '@common/enums';
import { objectIdString } from '@common/validators';

const objectIdParam = objectIdString;

export const matchIdParamSchema = z.object({
  matchId: objectIdParam('matchId'),
});
export type MatchIdParam = z.infer<typeof matchIdParamSchema>;

export const matchPlayerParamSchema = z.object({
  matchId: objectIdParam('matchId'),
  playerId: objectIdParam('playerId'),
});
export type MatchPlayerParam = z.infer<typeof matchPlayerParamSchema>;

export const recomputeMatchBodySchema = z.object({
  type: z
    .enum([
      ScoreEventType.LIVE_TICK,
      ScoreEventType.FINAL_RECONCILE,
      ScoreEventType.MANUAL_RECOMPUTE,
      ScoreEventType.RULE_CHANGE,
    ])
    .default(ScoreEventType.MANUAL_RECOMPUTE),
  reason: z.string().trim().max(280).optional(),
});
export type RecomputeMatchBody = z.infer<typeof recomputeMatchBodySchema>;

export const adjustPlayerPointsBodySchema = z.object({
  delta: z.number().refine((n) => n !== 0, { message: 'delta must be non-zero' }),
  reason: z.string().trim().min(3).max(280),
});
export type AdjustPlayerPointsBody = z.infer<typeof adjustPlayerPointsBodySchema>;

export const listScoreEventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListScoreEventsQuery = z.infer<typeof listScoreEventsQuerySchema>;

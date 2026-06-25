import { z } from 'zod';

import {
  MatchFormat,
  MatchStatus,
  PlayerRole,
  Sport,
  SportsProviderKey,
  TournamentStatus,
} from '@common/enums';
import { objectIdString, paginationSchema } from '@common/validators';

/**
 * Sports DTO validators.
 *
 * Public endpoints receive querystring filters; admin endpoints receive
 * JSON bodies that orchestrate ingestion and the featured rail. All
 * params land here as Zod schemas so controllers stay thin.
 */

const objectIdParam = objectIdString;

// ─── Match endpoints ──────────────────────────────────────────────────────

export const matchListQuerySchema = paginationSchema.extend({
  sport: z.nativeEnum(Sport).optional(),
  status: z.nativeEnum(MatchStatus).optional(),
  format: z.nativeEnum(MatchFormat).optional(),
  tournamentId: objectIdParam('tournamentId').optional(),
  teamId: objectIdParam('teamId').optional(),
  featured: z.coerce.boolean().optional(),
  /** Free-text search across team name + tournament name. */
  q: z.string().min(1).max(120).optional(),
  /** ISO date range. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type MatchListQuery = z.infer<typeof matchListQuerySchema>;

export const matchParamsSchema = z.object({
  matchId: objectIdParam('matchId'),
});
export type MatchParams = z.infer<typeof matchParamsSchema>;

export const matchUpdatesQuerySchema = z.object({
  /** Replay from this sequence forward. Defaults to 0 (full replay). */
  sinceSequence: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().positive().max(500).default(100),
});
export type MatchUpdatesQuery = z.infer<typeof matchUpdatesQuerySchema>;

// ─── Tournament + Team + Player endpoints ─────────────────────────────────

export const tournamentListQuerySchema = paginationSchema.extend({
  sport: z.nativeEnum(Sport).optional(),
  status: z.nativeEnum(TournamentStatus).optional(),
  q: z.string().min(1).max(120).optional(),
});
export type TournamentListQuery = z.infer<typeof tournamentListQuerySchema>;

export const tournamentParamsSchema = z.object({
  tournamentId: objectIdParam('tournamentId'),
});
export type TournamentParams = z.infer<typeof tournamentParamsSchema>;

export const teamListQuerySchema = paginationSchema.extend({
  sport: z.nativeEnum(Sport).optional(),
  q: z.string().min(1).max(120).optional(),
});
export type TeamListQuery = z.infer<typeof teamListQuerySchema>;

export const teamParamsSchema = z.object({
  teamId: objectIdParam('teamId'),
});
export type TeamParams = z.infer<typeof teamParamsSchema>;

export const playerListQuerySchema = paginationSchema.extend({
  sport: z.nativeEnum(Sport).optional(),
  role: z.nativeEnum(PlayerRole).optional(),
  teamId: objectIdParam('teamId').optional(),
  q: z.string().min(1).max(120).optional(),
});
export type PlayerListQuery = z.infer<typeof playerListQuerySchema>;

export const playerParamsSchema = z.object({
  playerId: objectIdParam('playerId'),
});
export type PlayerParams = z.infer<typeof playerParamsSchema>;

// ─── Admin sync / feature endpoints ───────────────────────────────────────

/**
 * Triggers a manual sync from a specific provider. `mode` selects which
 * ingestion to run; `force` bypasses the per-provider in-flight lock when
 * an operator KNOWS the previous run is stuck (rare).
 */
export const adminSyncBodySchema = z.object({
  provider: z.nativeEnum(SportsProviderKey).default(SportsProviderKey.MOCK),
  mode: z.enum(['matches', 'live', 'players', 'all']).default('all'),
  sport: z.nativeEnum(Sport).optional(),
  force: z.boolean().default(false),
});
export type AdminSyncBody = z.infer<typeof adminSyncBodySchema>;

export const adminFeatureBodySchema = z.object({
  isFeatured: z.boolean(),
});
export type AdminFeatureBody = z.infer<typeof adminFeatureBodySchema>;

export const adminCancelMatchBodySchema = z.object({
  reason: z.string().min(4).max(500),
});
export type AdminCancelMatchBody = z.infer<typeof adminCancelMatchBodySchema>;

export const adminCacheFlushBodySchema = z.object({
  scope: z.enum(['all', 'matches', 'players', 'teams', 'tournaments']).default('all'),
});
export type AdminCacheFlushBody = z.infer<typeof adminCacheFlushBodySchema>;

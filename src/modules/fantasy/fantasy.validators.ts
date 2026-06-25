import { z } from 'zod';

import {
  FantasyScoringCategory,
  MatchFormat,
  PlayerRole,
  Sport,
} from '@common/enums';
import { objectIdString, paginationSchema } from '@common/validators';

/**
 * Zod schemas for the fantasy HTTP layer.
 *
 * Validation runs in the `validate({ body / query / params })` middleware
 * so controllers receive typed inputs. Every dollar / credit field is
 * bounded — defence in depth against payload bombs.
 */

const objectIdParam = objectIdString;

// ─── Shared subschemas ────────────────────────────────────────────────

const roleConstraintSchema = z.object({
  role: z.nativeEnum(PlayerRole),
  min: z.number().int().min(0).max(30),
  max: z.number().int().min(0).max(30),
});

const teamPlayerInputSchema = z
  .object({
    playerId: objectIdParam('playerId'),
    isCaptain: z.boolean().default(false),
    isViceCaptain: z.boolean().default(false),
  })
  .refine((p) => !(p.isCaptain && p.isViceCaptain), {
    message: 'A player cannot be both captain and vice-captain',
  });

// ─── Rules — admin ────────────────────────────────────────────────────

const fantasyRuleObjectSchema = z.object({
  sport: z.nativeEnum(Sport),
  format: z.nativeEnum(MatchFormat),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  teamSize: z.number().int().min(1).max(30),
  creditBudget: z.number().positive().max(1000),
  minPerPlayerCredits: z.number().min(0).max(100).default(0),
  maxPerPlayerCredits: z.number().min(0).max(100).default(50),
  minFromSingleTeam: z.number().int().min(0).max(30),
  maxFromSingleTeam: z.number().int().min(1).max(30),
  roleConstraints: z.array(roleConstraintSchema).min(1),
  captainMultiplier: z.number().min(1).max(10).default(2),
  viceCaptainMultiplier: z.number().min(1).max(10).default(1.5),
  maxTeamsPerUserPerMatch: z.number().int().min(1).max(200).default(20),
  warnAtTeamsPerUserPerMatch: z.number().int().min(1).max(200).default(15),
  setActive: z.boolean().default(false),
});

const refineRule = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .refine(
      (d: { minFromSingleTeam?: number; maxFromSingleTeam?: number }) =>
        d.minFromSingleTeam === undefined ||
        d.maxFromSingleTeam === undefined ||
        d.minFromSingleTeam <= d.maxFromSingleTeam,
      { message: 'minFromSingleTeam must be ≤ maxFromSingleTeam' },
    )
    .refine(
      (d: { minPerPlayerCredits?: number; maxPerPlayerCredits?: number }) =>
        d.minPerPlayerCredits === undefined ||
        d.maxPerPlayerCredits === undefined ||
        d.minPerPlayerCredits <= d.maxPerPlayerCredits,
      { message: 'minPerPlayerCredits must be ≤ maxPerPlayerCredits' },
    )
    .refine(
      (d: { roleConstraints?: Array<{ min: number; max: number }> }) =>
        !d.roleConstraints || d.roleConstraints.every((r) => r.min <= r.max),
      { message: 'Each role constraint must have min ≤ max' },
    );

export const fantasyRuleCreateBodySchema = refineRule(fantasyRuleObjectSchema);
export type FantasyRuleCreateBody = z.infer<typeof fantasyRuleCreateBodySchema>;

export const fantasyRuleUpdateBodySchema = refineRule(fantasyRuleObjectSchema.partial());
export type FantasyRuleUpdateBody = z.infer<typeof fantasyRuleUpdateBodySchema>;

export const fantasyRuleListQuerySchema = paginationSchema.extend({
  sport: z.nativeEnum(Sport).optional(),
  format: z.nativeEnum(MatchFormat).optional(),
  isActive: z.coerce.boolean().optional(),
  q: z.string().min(1).max(120).optional(),
});
export type FantasyRuleListQuery = z.infer<typeof fantasyRuleListQuerySchema>;

export const fantasyRuleParamsSchema = z.object({ ruleId: objectIdParam('ruleId') });
export type FantasyRuleParams = z.infer<typeof fantasyRuleParamsSchema>;

// ─── Scoring rules — admin ────────────────────────────────────────────

const scoringEventInputSchema = z.object({
  code: z.string().min(1).max(64),
  category: z.nativeEnum(FantasyScoringCategory),
  label: z.string().min(1).max(120),
  statKey: z.string().min(1).max(64),
  points: z.number().min(-100).max(100),
  threshold: z.number().min(0).max(10_000).optional().nullable(),
  unit: z.number().min(0.0001).max(10_000).optional().nullable(),
  appliesTo: z.array(z.nativeEnum(PlayerRole)).default([]),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export const fantasyScoringRuleCreateBodySchema = z.object({
  sport: z.nativeEnum(Sport),
  format: z.nativeEnum(MatchFormat),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  events: z.array(scoringEventInputSchema).min(1),
  setActive: z.boolean().default(false),
});
export type FantasyScoringRuleCreateBody = z.infer<typeof fantasyScoringRuleCreateBodySchema>;

export const fantasyScoringRuleUpdateBodySchema = fantasyScoringRuleCreateBodySchema.partial();
export type FantasyScoringRuleUpdateBody = z.infer<typeof fantasyScoringRuleUpdateBodySchema>;

export const fantasyScoringRuleListQuerySchema = paginationSchema.extend({
  sport: z.nativeEnum(Sport).optional(),
  format: z.nativeEnum(MatchFormat).optional(),
  isActive: z.coerce.boolean().optional(),
  q: z.string().min(1).max(120).optional(),
});
export type FantasyScoringRuleListQuery = z.infer<typeof fantasyScoringRuleListQuerySchema>;

export const fantasyScoringRuleParamsSchema = z.object({
  ruleId: objectIdParam('ruleId'),
});
export type FantasyScoringRuleParams = z.infer<typeof fantasyScoringRuleParamsSchema>;

// ─── Match context (player listing for create-team UI) ────────────────

export const fantasyMatchContextParamsSchema = z.object({
  matchId: objectIdParam('matchId'),
});
export type FantasyMatchContextParams = z.infer<typeof fantasyMatchContextParamsSchema>;

// ─── Team — user ──────────────────────────────────────────────────────

export const fantasyTeamCreateBodySchema = z
  .object({
    matchId: objectIdParam('matchId'),
    name: z.string().trim().min(1).max(60).optional(),
    accentColor: z.string().trim().max(32).optional().nullable(),
    players: z.array(teamPlayerInputSchema).min(1).max(30),
  })
  .refine((d) => d.players.filter((p) => p.isCaptain).length === 1, {
    message: 'Exactly one captain must be selected',
    path: ['players'],
  })
  .refine((d) => d.players.filter((p) => p.isViceCaptain).length === 1, {
    message: 'Exactly one vice-captain must be selected',
    path: ['players'],
  });
export type FantasyTeamCreateBody = z.infer<typeof fantasyTeamCreateBodySchema>;

export const fantasyTeamUpdateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    accentColor: z.string().trim().max(32).optional().nullable(),
    players: z.array(teamPlayerInputSchema).min(1).max(30).optional(),
  })
  .refine(
    (d) => {
      if (!d.players) return true;
      return d.players.filter((p) => p.isCaptain).length === 1;
    },
    { message: 'Exactly one captain must be selected', path: ['players'] },
  )
  .refine(
    (d) => {
      if (!d.players) return true;
      return d.players.filter((p) => p.isViceCaptain).length === 1;
    },
    { message: 'Exactly one vice-captain must be selected', path: ['players'] },
  );
export type FantasyTeamUpdateBody = z.infer<typeof fantasyTeamUpdateBodySchema>;

export const fantasyTeamCloneBodySchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
});
export type FantasyTeamCloneBody = z.infer<typeof fantasyTeamCloneBodySchema>;

export const fantasyTeamListQuerySchema = paginationSchema.extend({
  matchId: objectIdParam('matchId').optional(),
});
export type FantasyTeamListQuery = z.infer<typeof fantasyTeamListQuerySchema>;

export const fantasyTeamParamsSchema = z.object({ teamId: objectIdParam('teamId') });
export type FantasyTeamParams = z.infer<typeof fantasyTeamParamsSchema>;

export const fantasyTeamPreviewBodySchema = z.object({
  matchId: objectIdParam('matchId'),
  players: z.array(teamPlayerInputSchema).min(0).max(30),
});
export type FantasyTeamPreviewBody = z.infer<typeof fantasyTeamPreviewBodySchema>;

// ─── Drafts ───────────────────────────────────────────────────────────

const draftPlayerInputSchema = z.object({
  playerId: objectIdParam('playerId'),
  isCaptain: z.boolean().default(false),
  isViceCaptain: z.boolean().default(false),
});

export const fantasyDraftUpsertBodySchema = z.object({
  matchId: objectIdParam('matchId'),
  clientDraftId: z.string().trim().min(1).max(64).optional().nullable(),
  name: z.string().trim().min(1).max(60).optional(),
  players: z.array(draftPlayerInputSchema).min(0).max(30),
});
export type FantasyDraftUpsertBody = z.infer<typeof fantasyDraftUpsertBodySchema>;

export const fantasyDraftListQuerySchema = z.object({
  matchId: objectIdParam('matchId'),
});
export type FantasyDraftListQuery = z.infer<typeof fantasyDraftListQuerySchema>;

export const fantasyDraftParamsSchema = z.object({ draftId: objectIdParam('draftId') });
export type FantasyDraftParams = z.infer<typeof fantasyDraftParamsSchema>;

import { z } from 'zod';

import { AppConstants } from '@common/constants';
import {
  ContestEntryStatus,
  ContestStatus,
  ContestType,
  ContestVisibility,
  MatchFormat,
  PrizeDistributionType,
  Sport,
} from '@common/enums';
import { objectIdString, paginationSchema } from '@common/validators';

/**
 * Zod schemas for the contest HTTP layer.
 *
 * Money is expressed in **MINOR units** at the API boundary so the FE
 * doesn't have to worry about cent-rounding bugs. Major-unit shortcuts
 * exist on the frontend.
 */

const objectIdParam = objectIdString;

// ─── Shared subschemas ────────────────────────────────────────────────

const moneyMinorUnits = z.number().int().min(0).max(
  AppConstants.CONTEST.PRIZE_POOL_MAX_MAJOR * AppConstants.MONEY.MINOR_UNITS_PER_MAJOR,
);

const currencyCode = z
  .string()
  .trim()
  .min(3)
  .max(3)
  .transform((v) => v.toUpperCase());

const prizeSlabSchema = z
  .object({
    fromRank: z.number().int().min(1),
    toRank: z.number().int().min(1),
    prizeAmount: moneyMinorUnits.default(0),
    percentageBps: z.number().int().min(0).max(10_000).default(0),
    bonusLabel: z.string().trim().max(80).nullable().optional(),
  })
  .refine((s) => s.toRank >= s.fromRank, {
    message: '`toRank` must be greater than or equal to `fromRank`',
  });

// ─── Prize distribution — admin ───────────────────────────────────────

export const prizeDistributionCreateBodySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).nullable().optional(),
    type: z.nativeEnum(PrizeDistributionType),
    referencePoolAmount: moneyMinorUnits,
    currency: currencyCode,
    slabs: z.array(prizeSlabSchema).min(1).max(200),
    isActive: z.boolean().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  })
  .refine((dto) => validateSlabs(dto.slabs, dto.type, dto.referencePoolAmount).ok, {
    message: 'Invalid slabs for the chosen distribution type',
    path: ['slabs'],
  });

export const prizeDistributionUpdateBodySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    type: z.nativeEnum(PrizeDistributionType).optional(),
    referencePoolAmount: moneyMinorUnits.optional(),
    currency: currencyCode.optional(),
    slabs: z.array(prizeSlabSchema).min(1).max(200).optional(),
    isActive: z.boolean().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  })
  .refine((dto) => Object.values(dto).some((v) => v !== undefined), {
    message: 'Update body cannot be empty',
  });

export const prizeDistributionListQuerySchema = paginationSchema.extend({
  type: z.nativeEnum(PrizeDistributionType).optional(),
  isActive: z.coerce.boolean().optional(),
  q: z.string().trim().min(1).max(80).optional(),
});

export const prizeDistributionParamsSchema = z.object({
  distributionId: objectIdParam('distributionId'),
});

// ─── Templates — admin ────────────────────────────────────────────────

const templateBaseShape = {
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  type: z.nativeEnum(ContestType),
  visibility: z.nativeEnum(ContestVisibility),
  sport: z.nativeEnum(Sport).nullable().optional(),
  format: z.nativeEnum(MatchFormat).nullable().optional(),
  entryFee: moneyMinorUnits,
  prizePoolAmount: moneyMinorUnits,
  currency: currencyCode,
  isGuaranteed: z.boolean().default(false),
  totalSpots: z.number().int().min(2).max(AppConstants.CONTEST.MAX_TOTAL_SPOTS),
  maxEntriesPerUser: z
    .number()
    .int()
    .min(1)
    .max(AppConstants.CONTEST.MAX_ENTRIES_PER_USER_HARD_CAP),
  prizeDistributionId: objectIdParam('prizeDistributionId').nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  isActive: z.boolean().optional(),
};

export const contestTemplateCreateBodySchema = z
  .object(templateBaseShape)
  .refine((dto) => dto.maxEntriesPerUser <= dto.totalSpots, {
    message: '`maxEntriesPerUser` cannot exceed `totalSpots`',
    path: ['maxEntriesPerUser'],
  });

export const contestTemplateUpdateBodySchema = z
  .object(templateBaseShape)
  .partial()
  .refine((dto) => Object.values(dto).some((v) => v !== undefined), {
    message: 'Update body cannot be empty',
  });

export const contestTemplateListQuerySchema = paginationSchema.extend({
  type: z.nativeEnum(ContestType).optional(),
  visibility: z.nativeEnum(ContestVisibility).optional(),
  sport: z.nativeEnum(Sport).optional(),
  isActive: z.coerce.boolean().optional(),
  q: z.string().trim().min(1).max(80).optional(),
});

export const contestTemplateParamsSchema = z.object({
  templateId: objectIdParam('templateId'),
});

// ─── Contests — admin create / update ─────────────────────────────────

export const adminContestCreateBodySchema = z
  .object({
    matchId: objectIdParam('matchId'),
    templateId: objectIdParam('templateId').nullable().optional(),
    name: z.string().trim().min(AppConstants.CONTEST.NAME.MIN_LENGTH).max(AppConstants.CONTEST.NAME.MAX_LENGTH),
    description: z.string().trim().max(500).nullable().optional(),
    type: z.nativeEnum(ContestType),
    visibility: z.nativeEnum(ContestVisibility).default(ContestVisibility.PUBLIC),
    inviteCode: z.string().trim().max(24).optional(),
    entryFee: moneyMinorUnits,
    prizePoolAmount: moneyMinorUnits,
    currency: currencyCode,
    totalSpots: z.number().int().min(2).max(AppConstants.CONTEST.MAX_TOTAL_SPOTS),
    maxEntriesPerUser: z
      .number()
      .int()
      .min(1)
      .max(AppConstants.CONTEST.MAX_ENTRIES_PER_USER_HARD_CAP),
    isGuaranteed: z.boolean().default(false),
    isPractice: z.boolean().default(false),
    joinOpensAt: z.string().datetime().nullable().optional(),
    joinClosesAt: z.string().datetime().nullable().optional(),
    publishImmediately: z.boolean().default(false),

    prizeDistributionId: objectIdParam('prizeDistributionId').nullable().optional(),
    /** Either reference a saved distribution OR inline the slabs here.
     *  At least one must be supplied unless `entryFee` and `prizePool`
     *  are both zero (PRACTICE contests). */
    prize: z
      .object({
        type: z.nativeEnum(PrizeDistributionType),
        slabs: z.array(prizeSlabSchema).min(1).max(200),
      })
      .optional(),
  })
  .refine((dto) => dto.maxEntriesPerUser <= dto.totalSpots, {
    message: '`maxEntriesPerUser` cannot exceed `totalSpots`',
    path: ['maxEntriesPerUser'],
  });

export const adminContestUpdateBodySchema = z
  .object({
    name: z.string().trim().min(AppConstants.CONTEST.NAME.MIN_LENGTH).max(AppConstants.CONTEST.NAME.MAX_LENGTH),
    description: z.string().trim().max(500).nullable(),
    visibility: z.nativeEnum(ContestVisibility),
    totalSpots: z.number().int().min(2).max(AppConstants.CONTEST.MAX_TOTAL_SPOTS),
    maxEntriesPerUser: z
      .number()
      .int()
      .min(1)
      .max(AppConstants.CONTEST.MAX_ENTRIES_PER_USER_HARD_CAP),
    prizePoolAmount: moneyMinorUnits,
    isGuaranteed: z.boolean(),
    joinOpensAt: z.string().datetime().nullable(),
    joinClosesAt: z.string().datetime().nullable(),
  })
  .partial()
  .refine((dto) => Object.values(dto).some((v) => v !== undefined), {
    message: 'Update body cannot be empty',
  });

export const adminContestStatusBodySchema = z.object({
  status: z.nativeEnum(ContestStatus),
});

export const adminContestCancelBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const contestCloneBodySchema = z.object({
  matchId: objectIdParam('matchId').optional(),
  name: z.string().trim().min(AppConstants.CONTEST.NAME.MIN_LENGTH).max(AppConstants.CONTEST.NAME.MAX_LENGTH).optional(),
  count: z.number().int().min(1).max(50).default(1),
});

// ─── Contest user-facing ──────────────────────────────────────────────

export const contestListQuerySchema = paginationSchema.extend({
  matchId: objectIdParam('matchId').optional(),
  type: z.nativeEnum(ContestType).optional(),
  status: z
    .union([
      z.nativeEnum(ContestStatus),
      z.array(z.nativeEnum(ContestStatus)).max(10),
    ])
    .optional(),
  minEntryFee: z.coerce.number().int().min(0).optional(),
  maxEntryFee: z.coerce.number().int().min(0).optional(),
  hideFull: z.coerce.boolean().optional(),
  q: z.string().trim().min(1).max(80).optional(),
});

export const adminContestListQuerySchema = paginationSchema.extend({
  matchId: objectIdParam('matchId').optional(),
  type: z.nativeEnum(ContestType).optional(),
  visibility: z.nativeEnum(ContestVisibility).optional(),
  status: z
    .union([
      z.nativeEnum(ContestStatus),
      z.array(z.nativeEnum(ContestStatus)).max(10),
    ])
    .optional(),
  q: z.string().trim().min(1).max(80).optional(),
});

export const contestParamsSchema = z.object({
  contestId: objectIdParam('contestId'),
});

export const contestInviteCodeQuerySchema = z.object({
  code: z.string().trim().min(3).max(24),
});

// ─── Join flow ────────────────────────────────────────────────────────

export const contestJoinBodySchema = z.object({
  teamId: objectIdParam('teamId'),
  /** Required for PRIVATE contests; ignored otherwise. */
  inviteCode: z.string().trim().min(3).max(24).optional(),
  /** Required for paid contests — wallet idempotency key. */
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

export const contestEntryListQuerySchema = paginationSchema.extend({
  contestId: objectIdParam('contestId').optional(),
  matchId: objectIdParam('matchId').optional(),
  status: z.nativeEnum(ContestEntryStatus).optional(),
});

export const contestEntryParamsSchema = z.object({
  entryId: objectIdParam('entryId'),
});

// ─── Exported types ───────────────────────────────────────────────────

export type PrizeDistributionCreateBody = z.infer<typeof prizeDistributionCreateBodySchema>;
export type PrizeDistributionUpdateBody = z.infer<typeof prizeDistributionUpdateBodySchema>;
export type PrizeDistributionListQuery = z.infer<typeof prizeDistributionListQuerySchema>;
export type PrizeDistributionParams = z.infer<typeof prizeDistributionParamsSchema>;

export type ContestTemplateCreateBody = z.infer<typeof contestTemplateCreateBodySchema>;
export type ContestTemplateUpdateBody = z.infer<typeof contestTemplateUpdateBodySchema>;
export type ContestTemplateListQuery = z.infer<typeof contestTemplateListQuerySchema>;
export type ContestTemplateParams = z.infer<typeof contestTemplateParamsSchema>;

export type AdminContestCreateBody = z.infer<typeof adminContestCreateBodySchema>;
export type AdminContestUpdateBody = z.infer<typeof adminContestUpdateBodySchema>;
export type AdminContestStatusBody = z.infer<typeof adminContestStatusBodySchema>;
export type AdminContestCancelBody = z.infer<typeof adminContestCancelBodySchema>;
export type ContestCloneBody = z.infer<typeof contestCloneBodySchema>;

export type ContestListQuery = z.infer<typeof contestListQuerySchema>;
export type AdminContestListQuery = z.infer<typeof adminContestListQuerySchema>;
export type ContestParams = z.infer<typeof contestParamsSchema>;
export type ContestInviteCodeQuery = z.infer<typeof contestInviteCodeQuerySchema>;

export type ContestJoinBody = z.infer<typeof contestJoinBodySchema>;
export type ContestEntryListQuery = z.infer<typeof contestEntryListQuerySchema>;
export type ContestEntryParams = z.infer<typeof contestEntryParamsSchema>;

// ─── Pure-function helpers (exported for service-layer reuse) ─────────

/**
 * Slab validation logic that's shared by the Zod refinement above AND
 * by the service layer's deeper checks (e.g. when binding a template
 * to a contest with a different prize pool).
 *
 * Rules enforced:
 *  - Slabs are sorted ascending by `fromRank`.
 *  - Slabs are contiguous: `slabs[i].fromRank === slabs[i-1].toRank + 1`.
 *  - First slab starts at rank 1.
 *  - For PERCENTAGE_BASED: sum of `(toRank - fromRank + 1) * percentageBps`
 *    must equal 10_000 (= 100.00%).
 *  - For RANK_BASED + FIXED: sum of `(toRank - fromRank + 1) * prizeAmount`
 *    must equal `pool` (when supplied).
 */
export type SlabValidationResult = { ok: true } | { ok: false; reason: string };

export const validateSlabs = (
  slabs: Array<{ fromRank: number; toRank: number; prizeAmount: number; percentageBps: number }>,
  type: PrizeDistributionType,
  pool: number | null,
): SlabValidationResult => {
  if (slabs.length === 0) return { ok: false, reason: 'No slabs supplied' };
  const sorted = [...slabs].sort((a, b) => a.fromRank - b.fromRank);

  if (sorted[0]?.fromRank !== 1) {
    return { ok: false, reason: 'First slab must start at rank 1' };
  }

  for (let i = 0; i < sorted.length; i++) {
    const slab = sorted[i]!;
    if (slab.toRank < slab.fromRank) {
      return { ok: false, reason: `Slab ${i + 1}: toRank < fromRank` };
    }
    if (i > 0 && sorted[i - 1]!.toRank + 1 !== slab.fromRank) {
      return { ok: false, reason: `Slab ${i + 1}: ranks not contiguous` };
    }
  }

  if (type === PrizeDistributionType.PERCENTAGE_BASED) {
    const totalBps = sorted.reduce(
      (sum, s) => sum + (s.toRank - s.fromRank + 1) * s.percentageBps,
      0,
    );
    if (totalBps !== 10_000) {
      return { ok: false, reason: `Sum of percentages must be 100% (got ${totalBps / 100}%)` };
    }
  }

  if (type !== PrizeDistributionType.PERCENTAGE_BASED && pool !== null) {
    const totalAmount = sorted.reduce(
      (sum, s) => sum + (s.toRank - s.fromRank + 1) * s.prizeAmount,
      0,
    );
    if (totalAmount !== pool) {
      return { ok: false, reason: `Sum of prize amounts (${totalAmount}) must equal pool (${pool})` };
    }
  }

  return { ok: true };
};

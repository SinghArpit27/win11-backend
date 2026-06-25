import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { PrizeDistributionType } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Canonical `prize_distributions` collection — reusable prize templates
 * that contests reference instead of carrying their own slab list.
 *
 * Two layers of prize data exist in the system:
 *
 *   1. `PrizeDistribution` (this collection)  — the *template*. Created
 *      once by an admin (e.g. "Mega 1L prize, percentage split, 10 slabs")
 *      and then referenced by N contests.
 *   2. `Contest.prizeDistribution`            — an *embedded snapshot*
 *      taken at contest-create time so the contest is immune to template
 *      edits afterwards. This is the source of truth at payout time.
 *
 * Keeping the source-of-truth on the contest itself protects against
 * footguns where editing a template would silently mutate every live
 * contest's prize structure. The template only lives here for reuse.
 *
 *
 * Slabs follow the half-open `[fromRank, toRank]` convention — both
 * bounds inclusive. Service-level validation guarantees:
 *   - slabs are contiguous, non-overlapping, in ascending order;
 *   - the union of slabs covers ranks 1..maxWinningRank;
 *   - PERCENTAGE_BASED sums to 10_000 basis points (= 100.00%);
 *   - RANK_BASED & FIXED amounts are integer minor units, > 0.
 */
export interface IPrizeSlab {
  fromRank: number;
  toRank: number;
  /** Fixed prize for RANK_BASED / FIXED. Minor units (paise / cents). */
  prizeAmount: number;
  /** Basis points of the pool for PERCENTAGE_BASED (10000 = 100%). */
  percentageBps: number;
  /** Optional non-monetary label e.g. "iPhone 15", "Premium Subscription". */
  bonusLabel: string | null;
}

export interface IPrizeDistribution extends BaseDocFields {
  _id: Types.ObjectId;

  /** Admin-friendly name shown in the template picker. */
  name: string;
  description: string | null;
  /** Distribution archetype — drives validation + payout calc. */
  type: PrizeDistributionType;
  /**
   * Reference pool the template was authored against, in minor units.
   * Used by the contest service for sanity checks when binding the
   * template to a contest with a different pool. For PERCENTAGE_BASED
   * templates this is purely documentary; for RANK_BASED / FIXED
   * templates the slab amounts must sum to this value.
   */
  referencePoolAmount: number;
  currency: string;
  slabs: IPrizeSlab[];
  /** Maximum rank that wins anything — `slabs[last].toRank`. */
  maxWinningRank: number;
  /** Toggle so admins can retire stale templates without deleting. */
  isActive: boolean;
  /** Optional tag for sorting / grouping in the admin picker. */
  tags: string[];
}

export type PrizeDistributionDoc = HydratedDocument<IPrizeDistribution>;
export type PrizeDistributionModel = Model<IPrizeDistribution>;

const prizeSlabSchema = new Schema<IPrizeSlab>(
  {
    fromRank: { type: Number, required: true, min: 1 },
    toRank: { type: Number, required: true, min: 1 },
    prizeAmount: { type: Number, required: true, default: 0, min: 0 },
    percentageBps: { type: Number, required: true, default: 0, min: 0, max: 10_000 },
    bonusLabel: { type: String, default: null, trim: true, maxlength: 80 },
  },
  { _id: false },
);

const prizeDistributionSchema = createBaseSchema<IPrizeDistribution>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120, index: true },
    description: { type: String, default: null, trim: true, maxlength: 500 },
    type: {
      type: String,
      enum: Object.values(PrizeDistributionType),
      required: true,
      default: PrizeDistributionType.RANK_BASED,
      index: true,
    },
    referencePoolAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true, maxlength: 3 },
    slabs: {
      type: [prizeSlabSchema],
      required: true,
      default: [],
      validate: {
        validator: (arr: IPrizeSlab[]) => arr.length > 0 && arr.length <= 200,
        message: 'A prize distribution must contain between 1 and 200 slabs',
      },
    },
    maxWinningRank: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, required: true, default: true, index: true },
    tags: { type: [String], default: [] },
  },
  { collection: 'prize_distributions' },
);

// Listing index — admin picker filters by type + active flag.
prizeDistributionSchema.index({ type: 1, isActive: 1, updatedAt: -1 });
// Reuse-stat aggregation index — `contests.prizeDistributionId` joins
// against this so we want a stable single-field lookup path.
prizeDistributionSchema.index({ _id: 1, isDeleted: 1 });

export const PrizeDistribution: PrizeDistributionModel = model<IPrizeDistribution>(
  'PrizeDistribution',
  prizeDistributionSchema,
);

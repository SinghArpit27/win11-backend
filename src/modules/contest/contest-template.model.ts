import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import {
  ContestType,
  ContestVisibility,
  MatchFormat,
  Sport,
} from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * `contest_templates` collection — reusable contest blueprints.
 *
 * A template captures all the *static* attributes of a contest archetype
 * (entry fee, total spots, max entries per user, prize distribution
 * reference, etc.) so admins can spin up dozens of contests per match
 * with one click.
 *
 * Templates are sport / format aware so the same admin UI can serve
 * cricket + football + kabaddi without mixing inappropriate defaults.
 *
 * Templates DO NOT bind themselves to a match — that happens at
 * contest-create time. Concrete contests carry a `templateId` pointer
 * for audit but operate on their own copy of every field so editing a
 * template never silently mutates live contests.
 */
export interface IContestTemplate extends BaseDocFields {
  _id: Types.ObjectId;

  name: string;
  description: string | null;
  type: ContestType;
  visibility: ContestVisibility;

  /** Templates can target a single sport+format or be sport-agnostic
   *  (null sport ⇒ usable everywhere; null format ⇒ any format of the
   *  bound sport). The contest-create flow validates compatibility. */
  sport: Sport | null;
  format: MatchFormat | null;

  /** Money values — minor units. */
  entryFee: number;
  prizePoolAmount: number;
  currency: string;
  /** True ⇒ prize pool is paid out even when the contest doesn't fill. */
  isGuaranteed: boolean;

  totalSpots: number;
  maxEntriesPerUser: number;

  /** Optional reference to a `prize_distributions` template. Contests
   *  embedded their own snapshot, but the template just references the
   *  reusable one. */
  prizeDistributionId: Types.ObjectId | null;

  /** Tags shown in the admin picker (e.g. "weekly", "promo"). */
  tags: string[];
  /** Admin-only toggle so retired blueprints stay around for audit. */
  isActive: boolean;

  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
}

export type ContestTemplateDoc = HydratedDocument<IContestTemplate>;
export type ContestTemplateModel = Model<IContestTemplate>;

const contestTemplateSchema = createBaseSchema<IContestTemplate>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120, index: true },
    description: { type: String, default: null, trim: true, maxlength: 500 },
    type: {
      type: String,
      enum: Object.values(ContestType),
      required: true,
      default: ContestType.REGULAR,
      index: true,
    },
    visibility: {
      type: String,
      enum: Object.values(ContestVisibility),
      required: true,
      default: ContestVisibility.PUBLIC,
    },

    sport: { type: String, enum: Object.values(Sport), default: null, index: true },
    format: { type: String, enum: Object.values(MatchFormat), default: null },

    entryFee: { type: Number, required: true, min: 0 },
    prizePoolAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true, maxlength: 3 },
    isGuaranteed: { type: Boolean, required: true, default: false },

    totalSpots: { type: Number, required: true, min: 2 },
    maxEntriesPerUser: { type: Number, required: true, min: 1 },

    prizeDistributionId: {
      type: Schema.Types.ObjectId,
      ref: 'PrizeDistribution',
      default: null,
      index: true,
    },

    tags: { type: [String], default: [] },
    isActive: { type: Boolean, required: true, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'contest_templates' },
);

contestTemplateSchema.index({ type: 1, isActive: 1, updatedAt: -1 });
contestTemplateSchema.index({ sport: 1, isActive: 1, type: 1 });

export const ContestTemplate: ContestTemplateModel = model<IContestTemplate>(
  'ContestTemplate',
  contestTemplateSchema,
);

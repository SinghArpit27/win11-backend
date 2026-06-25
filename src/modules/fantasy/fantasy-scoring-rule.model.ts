import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import {
  FantasyScoringCategory,
  FantasyScoringEventCode,
  MatchFormat,
  PlayerRole,
  Sport,
} from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Configurable scoring rule set used by the fantasy scoring engine.
 *
 * Each document is a *snapshot* of how to convert raw match stats into
 * fantasy points. Captain / vice-captain multipliers live on
 * `FantasyRule`, not here — this collection is the pure points table so
 * a single rule set can be reused across multiple team-building rule
 * variants (e.g. "T20 default" + "T20 mega-contest").
 *
 * Storage shape:
 *   `events`  — array of `IScoringEvent`. Each event is a (code, points)
 *               row; the engine looks up a stat by `code` then multiplies
 *               by the value present on `PlayerStats.stats[statKey]`.
 *
 * The `statKey` indirection lets the scoring engine work with arbitrary
 * upstream stat schemas — the engine never hardcodes a stat name.
 */
export interface IScoringEvent {
  /** Stable code (member of `FantasyScoringEventCode`). */
  code: string;
  category: FantasyScoringCategory;
  /** Display label used by admin UI + tooltips. */
  label: string;
  /**
   * Key into `PlayerStats.stats[k]`. The engine reads this value as a
   * number and multiplies by `points`. For one-shot bonuses (e.g.
   * "scored 50") use `threshold` instead.
   */
  statKey: string;
  /** Points per unit. Negative for penalties. */
  points: number;
  /** When set, points are added once if `stats[statKey] >= threshold`. */
  threshold: number | null;
  /** When set, scaling factor — e.g. every 4 runs adds N. */
  unit: number | null;
  /** Optional role gate — applies to only these roles. */
  appliesTo: PlayerRole[];
  /** Optional sort order used to render the rule book consistently. */
  sortOrder: number;
}

export interface IFantasyScoringRule extends BaseDocFields {
  _id: Types.ObjectId;

  sport: Sport;
  format: MatchFormat;

  name: string;
  description: string | null;

  isActive: boolean;
  /** Snapshot version. Higher number is newer. */
  version: number;

  events: IScoringEvent[];

  createdByAdminId: Types.ObjectId | null;
  updatedByAdminId: Types.ObjectId | null;
}

export type FantasyScoringRuleDoc = HydratedDocument<IFantasyScoringRule>;
export type FantasyScoringRuleModel = Model<IFantasyScoringRule>;

const scoringEventSchema = new Schema<IScoringEvent>(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
      // `FantasyScoringEventCode` lists the shipped codes — admins can
      // add custom ones, so we don't `enum: ...` lock the field.
    },
    category: {
      type: String,
      enum: Object.values(FantasyScoringCategory),
      required: true,
    },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    statKey: { type: String, required: true, trim: true, maxlength: 64 },
    points: { type: Number, required: true, min: -100, max: 100 },
    threshold: { type: Number, default: null, min: 0, max: 10_000 },
    unit: { type: Number, default: null, min: 0.0001, max: 10_000 },
    appliesTo: {
      type: [String],
      enum: Object.values(PlayerRole),
      default: [],
    },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

const fantasyScoringRuleSchema = createBaseSchema<IFantasyScoringRule>(
  {
    sport: { type: String, enum: Object.values(Sport), required: true, index: true },
    format: { type: String, enum: Object.values(MatchFormat), required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: null, trim: true, maxlength: 500 },

    isActive: { type: Boolean, required: true, default: false, index: true },
    version: { type: Number, required: true, default: 1, min: 1 },

    events: { type: [scoringEventSchema], required: true, default: [] },

    createdByAdminId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByAdminId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'fantasy_scoring_rules' },
);

fantasyScoringRuleSchema.index(
  { sport: 1, format: 1, isActive: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true, isDeleted: false },
    name: 'fantasy_scoring_rules_one_active_per_sport_format',
  },
);
fantasyScoringRuleSchema.index({ sport: 1, format: 1, version: -1 });

// `FantasyScoringEventCode` is referenced by the seeder + admin UI but
// not enforced at the schema level — re-export so callers don't have to
// reach into `@common/enums` for it.
export { FantasyScoringEventCode };

export const FantasyScoringRule: FantasyScoringRuleModel = model<IFantasyScoringRule>(
  'FantasyScoringRule',
  fantasyScoringRuleSchema,
);

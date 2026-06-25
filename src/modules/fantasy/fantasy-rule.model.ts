import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { MatchFormat, PlayerRole, Sport } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Configurable rule set that governs how a fantasy team is built.
 *
 * One *active* rule set exists per (sport, format) tuple — older versions
 * are kept for audit and historical scoring. Admins clone + mutate + flip
 * `isActive`; the service guarantees mutual exclusivity at the unique
 * partial-index level.
 *
 * Rules are loaded into Redis on read; cache is invalidated on any write.
 */
export interface IRoleConstraint {
  role: PlayerRole;
  /** Inclusive. */
  min: number;
  /** Inclusive. */
  max: number;
}

export interface IFantasyRule extends BaseDocFields {
  _id: Types.ObjectId;

  sport: Sport;
  format: MatchFormat;

  /** Human label shown in the admin grid (e.g. "Cricket T20 — Default"). */
  name: string;
  description: string | null;

  /** Only one document per (sport, format) can have `isActive: true`. */
  isActive: boolean;

  /** Total players in a finalised team (e.g. 11 for cricket / football). */
  teamSize: number;

  /** Hard credit budget enforced by the validator. */
  creditBudget: number;
  /** Optional floor per player — defaults to `0` (no floor). */
  minPerPlayerCredits: number;
  /** Optional cap per player — defaults to `creditBudget` (no cap). */
  maxPerPlayerCredits: number;

  /** Min players that must come from each of the two real-world teams. */
  minFromSingleTeam: number;
  /** Cap on players from a single real-world team. */
  maxFromSingleTeam: number;

  /** Per-role min/max constraints. */
  roleConstraints: IRoleConstraint[];

  /** Captain point multiplier (default 2x). */
  captainMultiplier: number;
  /** Vice-captain point multiplier (default 1.5x). */
  viceCaptainMultiplier: number;

  /** Hard cap on saved (non-draft) teams a single user can keep per match. */
  maxTeamsPerUserPerMatch: number;

  /** Soft cap warning threshold (e.g. show "you're at 18/20"). */
  warnAtTeamsPerUserPerMatch: number;

  /** ISO admin id that authored this version. */
  createdByAdminId: Types.ObjectId | null;
  /** ISO admin id that last touched this version. */
  updatedByAdminId: Types.ObjectId | null;

  /** Used to identify older rule snapshots a team was created against. */
  version: number;
}

export type FantasyRuleDoc = HydratedDocument<IFantasyRule>;
export type FantasyRuleModel = Model<IFantasyRule>;

const roleConstraintSchema = new Schema<IRoleConstraint>(
  {
    role: { type: String, enum: Object.values(PlayerRole), required: true },
    min: { type: Number, required: true, min: 0, max: 30 },
    max: { type: Number, required: true, min: 0, max: 30 },
  },
  { _id: false },
);

const fantasyRuleSchema = createBaseSchema<IFantasyRule>(
  {
    sport: { type: String, enum: Object.values(Sport), required: true, index: true },
    format: { type: String, enum: Object.values(MatchFormat), required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: null, trim: true, maxlength: 500 },

    isActive: { type: Boolean, required: true, default: false, index: true },

    teamSize: { type: Number, required: true, min: 1, max: 30 },

    creditBudget: { type: Number, required: true, min: 1, max: 1000 },
    minPerPlayerCredits: { type: Number, required: true, default: 0, min: 0, max: 100 },
    maxPerPlayerCredits: { type: Number, required: true, default: 50, min: 0, max: 100 },

    minFromSingleTeam: { type: Number, required: true, min: 0, max: 30 },
    maxFromSingleTeam: { type: Number, required: true, min: 1, max: 30 },

    roleConstraints: { type: [roleConstraintSchema], required: true, default: [] },

    captainMultiplier: { type: Number, required: true, default: 2, min: 1, max: 10 },
    viceCaptainMultiplier: { type: Number, required: true, default: 1.5, min: 1, max: 10 },

    maxTeamsPerUserPerMatch: { type: Number, required: true, default: 20, min: 1, max: 200 },
    warnAtTeamsPerUserPerMatch: { type: Number, required: true, default: 15, min: 1, max: 200 },

    createdByAdminId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByAdminId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    version: { type: Number, required: true, default: 1, min: 1 },
  },
  { collection: 'fantasy_rules' },
);

// Only ONE active rule per (sport, format).
fantasyRuleSchema.index(
  { sport: 1, format: 1, isActive: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true, isDeleted: false },
    name: 'fantasy_rules_one_active_per_sport_format',
  },
);
fantasyRuleSchema.index({ sport: 1, format: 1, version: -1 });
fantasyRuleSchema.index({ updatedAt: -1 });

export const FantasyRule: FantasyRuleModel = model<IFantasyRule>(
  'FantasyRule',
  fantasyRuleSchema,
);

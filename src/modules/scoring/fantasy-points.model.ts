import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { FantasyScoringCategory, PlayerRole } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * `fantasy_points` — one row per `(matchId, playerId)` that captures
 * the **rich, persistable** fantasy point breakdown for a player in a
 * given match.
 *
 * Why not just live on `player_stats`?
 *   - `player_stats` is the *raw event store* — runs, wickets, catches.
 *     Mixing the multiplier-aware fantasy breakdown there couples the
 *     ingestion schema to the scoring engine.
 *   - This collection is **scoring-rule-versioned**. Re-scoring with a
 *     newer rule replaces the row in place; the upstream raw stats are
 *     untouched.
 *
 * Reads:
 *   - Player point cards on the leaderboard ("M Starc: 32, 4w, 18 dot →
 *     94 pts"). One round-trip, no engine call.
 *   - Player-of-match calculations and contest result pages.
 *
 * Writes:
 *   - The scoring engine bulk-upserts these in batches inside the same
 *     transaction it updates `FantasyTeam.totalPoints` so the two
 *     never diverge.
 */
export interface IFantasyPointEvent {
  /** Stable scoring event code from `FantasyScoringEventCode`. */
  code: string;
  category: FantasyScoringCategory;
  label: string;
  /** Raw stat value pulled from `player_stats.stats[statKey]`. */
  rawValue: number;
  /** Points awarded by this event after threshold / unit logic. */
  points: number;
}

export interface IFantasyPointBreakdown {
  batting: number;
  bowling: number;
  fielding: number;
  bonus: number;
  penalty: number;
}

export interface IFantasyPoints extends BaseDocFields {
  _id: Types.ObjectId;

  matchId: Types.ObjectId;
  playerId: Types.ObjectId;
  teamId: Types.ObjectId | null;
  role: PlayerRole;

  /** Base fantasy points BEFORE any captain / vice-captain multiplier. */
  basePoints: number;
  /** Per-category subtotals. */
  breakdown: IFantasyPointBreakdown;
  /** Itemised events for traceability + the "tap for breakdown" UI. */
  events: IFantasyPointEvent[];

  /** Versioning — every recompute bumps this so the FE can detect staleness. */
  scoringRuleId: Types.ObjectId | null;
  scoringRuleVersion: number | null;

  /** True iff the player took the field. Used by the engine to skip
   *  zero-row generation when stats arrive empty (DNP cases). */
  isPlayed: boolean;
  /** Cached "player of the match" flag from `player_stats`. */
  isPlayerOfMatch: boolean;

  /** Wall-clock of the last successful recompute for this player. */
  computedAt: Date;
}

export type FantasyPointsDoc = HydratedDocument<IFantasyPoints>;
export type FantasyPointsModel = Model<IFantasyPoints>;

const fantasyPointEventSchema = new Schema<IFantasyPointEvent>(
  {
    code: { type: String, required: true, trim: true, maxlength: 80 },
    category: {
      type: String,
      enum: Object.values(FantasyScoringCategory),
      required: true,
    },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    rawValue: { type: Number, required: true },
    points: { type: Number, required: true },
  },
  { _id: false },
);

const fantasyPointBreakdownSchema = new Schema<IFantasyPointBreakdown>(
  {
    batting: { type: Number, required: true, default: 0 },
    bowling: { type: Number, required: true, default: 0 },
    fielding: { type: Number, required: true, default: 0 },
    bonus: { type: Number, required: true, default: 0 },
    penalty: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const fantasyPointsSchema = createBaseSchema<IFantasyPoints>(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
    role: {
      type: String,
      enum: Object.values(PlayerRole),
      required: true,
      default: PlayerRole.UNKNOWN,
    },

    basePoints: { type: Number, required: true, default: 0 },
    breakdown: { type: fantasyPointBreakdownSchema, required: true, default: () => ({}) },
    events: { type: [fantasyPointEventSchema], required: true, default: () => [] },

    scoringRuleId: {
      type: Schema.Types.ObjectId,
      ref: 'FantasyScoringRule',
      default: null,
    },
    scoringRuleVersion: { type: Number, default: null, min: 0 },

    isPlayed: { type: Boolean, required: true, default: false },
    isPlayerOfMatch: { type: Boolean, required: true, default: false },

    computedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'fantasy_points' },
);

// One row per (match, player) — upsert target for the scoring engine.
fantasyPointsSchema.index(
  { matchId: 1, playerId: 1 },
  { unique: true, name: 'fantasy_points_match_player_unique' },
);
// Match-wide "top scorers" board.
fantasyPointsSchema.index({ matchId: 1, basePoints: -1 });
// Per-role analytics & filters.
fantasyPointsSchema.index({ matchId: 1, role: 1, basePoints: -1 });

export const FantasyPoints: FantasyPointsModel = model<IFantasyPoints>(
  'FantasyPoints',
  fantasyPointsSchema,
);

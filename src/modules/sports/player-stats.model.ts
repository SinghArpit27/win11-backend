import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { Sport } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Canonical `player_stats` collection — one row per (player × match).
 *
 * Holds the player's per-match statline plus their pre-computed fantasy
 * points. The fantasy point computation itself lives behind a sport-
 * specific scoring engine (Phase 7) — Phase 4 just lays down the
 * schema + a `fantasyPoints` placeholder field that downstream phases
 * will populate.
 *
 * `stats` is a loose Record because cricket / football / kabaddi have
 * wildly different statlines. Sport-specific UI selectors decide what
 * to render. NEVER add typed top-level fields here — only sport-shared
 * fields (e.g. `minutesPlayed`) belong as columns.
 */
export interface IPlayerStats extends BaseDocFields {
  _id: Types.ObjectId;

  matchId: Types.ObjectId;
  playerId: Types.ObjectId;
  /** Denormalised so analytics queries don't join. */
  sport: Sport;
  /** Denormalised team for fast "by team" aggregations. */
  teamId: Types.ObjectId | null;

  /** Whether the player is in the official starting XI / matchday squad. */
  isInLineup: boolean;
  /** Whether they actually featured (played any minute). */
  isPlayed: boolean;
  /** Whether they were named the player of the match. */
  isPlayerOfMatch: boolean;

  /** Sport-specific statline. */
  stats: Record<string, number | string | boolean | null>;

  /**
   * Pre-computed fantasy points — populated by the scoring engine
   * (Phase 7). Stored here so contest leaderboards don't recompute on
   * every read. Defaults to 0 while Phase 4 is in flight.
   */
  fantasyPoints: number;

  /** Last provider sync — used for staleness checks. */
  lastSyncedAt: Date | null;
}

export type PlayerStatsDoc = HydratedDocument<IPlayerStats>;
export type PlayerStatsModel = Model<IPlayerStats>;

const playerStatsSchema = createBaseSchema<IPlayerStats>(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true, index: true },
    sport: { type: String, enum: Object.values(Sport), required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', default: null },

    isInLineup: { type: Boolean, default: false },
    isPlayed: { type: Boolean, default: false },
    isPlayerOfMatch: { type: Boolean, default: false },

    stats: { type: Schema.Types.Mixed, default: {} },

    fantasyPoints: { type: Number, default: 0, min: 0 },

    lastSyncedAt: { type: Date, default: null },
  },
  { collection: 'player_stats' },
);

// One row per (player, match). Re-running ingestion upserts.
playerStatsSchema.index(
  { matchId: 1, playerId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
// Per-match lineup read.
playerStatsSchema.index({ matchId: 1, isInLineup: 1 });
// Per-player history queries.
playerStatsSchema.index({ playerId: 1, createdAt: -1 });

export const PlayerStats: PlayerStatsModel = model<IPlayerStats>(
  'PlayerStats',
  playerStatsSchema,
);

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { LeaderboardScope, LeaderboardSnapshotReason } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * `leaderboard_snapshots` — point-in-time freezes of a leaderboard.
 *
 * Why snapshot at all?
 *   - Redis sorted sets are *live* — they only know "right now". To
 *     compute rank movement (UP/DOWN/SAME) we need the previous
 *     position; that lives here.
 *   - History persists past Redis evictions / restarts.
 *   - Snapshots double as the source for "as-of" leaderboard views in
 *     the FE (e.g. "leaderboard at end of innings").
 *
 * Storage trade-off:
 *   - We store the **top-N preview** (default 3) inline so the FE can
 *     render the podium without a second round-trip.
 *   - Full rank rows live on `rank_histories` (per-user delta rows)
 *     instead of being denormalised here — that keeps each snapshot
 *     small even for million-entry contests.
 */
export interface ILeaderboardTopEntry {
  rank: number;
  entryId: Types.ObjectId;
  userId: Types.ObjectId;
  teamId: Types.ObjectId;
  displayName: string;
  points: number;
}

export interface ILeaderboardSnapshot extends BaseDocFields {
  _id: Types.ObjectId;

  scope: LeaderboardScope;
  /** Stable string key — contestId for CONTEST, matchId for MATCH, etc. */
  scopeId: Types.ObjectId;
  matchId: Types.ObjectId;

  reason: LeaderboardSnapshotReason;

  /** Total entries ranked at this instant. */
  totalEntries: number;
  /** Highest score in the leaderboard at snapshot time. */
  topScore: number;
  /** Top-N preview rendered on the contest card / podium. */
  topEntries: ILeaderboardTopEntry[];

  /** Source `score_events._id` that triggered this snapshot (audit). */
  scoreEventId: Types.ObjectId | null;

  /** Wall-clock when the snapshot was taken (≠ createdAt for legacy rows). */
  capturedAt: Date;
}

export type LeaderboardSnapshotDoc = HydratedDocument<ILeaderboardSnapshot>;
export type LeaderboardSnapshotModel = Model<ILeaderboardSnapshot>;

const topEntrySchema = new Schema<ILeaderboardTopEntry>(
  {
    rank: { type: Number, required: true, min: 1 },
    entryId: { type: Schema.Types.ObjectId, ref: 'ContestEntry', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'FantasyTeam', required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 120 },
    points: { type: Number, required: true },
  },
  { _id: false },
);

const leaderboardSnapshotSchema = createBaseSchema<ILeaderboardSnapshot>(
  {
    scope: {
      type: String,
      enum: Object.values(LeaderboardScope),
      required: true,
      index: true,
    },
    scopeId: { type: Schema.Types.ObjectId, required: true, index: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },

    reason: {
      type: String,
      enum: Object.values(LeaderboardSnapshotReason),
      required: true,
      default: LeaderboardSnapshotReason.LIVE_TICK,
    },

    totalEntries: { type: Number, required: true, default: 0, min: 0 },
    topScore: { type: Number, required: true, default: 0 },
    topEntries: { type: [topEntrySchema], required: true, default: [] },

    scoreEventId: { type: Schema.Types.ObjectId, ref: 'ScoreEvent', default: null },

    capturedAt: { type: Date, required: true, default: () => new Date(), index: true },
  },
  { collection: 'leaderboard_snapshots' },
);

leaderboardSnapshotSchema.index({ scope: 1, scopeId: 1, capturedAt: -1 });
leaderboardSnapshotSchema.index({ matchId: 1, capturedAt: -1 });

export const LeaderboardSnapshot: LeaderboardSnapshotModel = model<ILeaderboardSnapshot>(
  'LeaderboardSnapshot',
  leaderboardSnapshotSchema,
);

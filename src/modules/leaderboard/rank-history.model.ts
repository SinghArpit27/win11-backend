import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { LeaderboardScope, RankMovement } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * `rank_histories` — per-entry timeline of `(rank, points)` deltas.
 *
 * Written by the leaderboard snapshot worker on **changes only**
 * (debounced) — we don't write a row every 10s for every entry; only
 * when an entry's rank or points actually moves. This keeps the
 * collection bounded even with hundreds of thousands of entries.
 *
 * Reads:
 *   - "My rank history" graph on the user dashboard.
 *   - Rank movement indicators (UP / DOWN / SAME / NEW) — the FE
 *     compares the latest two rows for a `(scope, entry)`.
 *   - Admin "ranking audit" tools.
 *
 * The schema is intentionally narrow — every Phase-7 use case the
 * platform needs today is satisfied by `{rank, points, movement}`.
 */
export interface IRankHistory extends BaseDocFields {
  _id: Types.ObjectId;

  scope: LeaderboardScope;
  scopeId: Types.ObjectId;
  /** Source contestEntry (CONTEST scope) or fantasyTeam (MATCH scope). */
  entryId: Types.ObjectId;

  matchId: Types.ObjectId;
  userId: Types.ObjectId;

  rank: number;
  points: number;

  /** Previous values — null when this is the first row for the entry. */
  previousRank: number | null;
  previousPoints: number | null;
  movement: RankMovement;
  rankDelta: number;
  pointsDelta: number;

  /** Snapshot that produced this row (audit). */
  snapshotId: Types.ObjectId | null;
  capturedAt: Date;
}

export type RankHistoryDoc = HydratedDocument<IRankHistory>;
export type RankHistoryModel = Model<IRankHistory>;

const rankHistorySchema = createBaseSchema<IRankHistory>(
  {
    scope: {
      type: String,
      enum: Object.values(LeaderboardScope),
      required: true,
      index: true,
    },
    scopeId: { type: Schema.Types.ObjectId, required: true, index: true },
    entryId: { type: Schema.Types.ObjectId, required: true, index: true },

    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    rank: { type: Number, required: true, min: 1 },
    points: { type: Number, required: true },

    previousRank: { type: Number, default: null, min: 1 },
    previousPoints: { type: Number, default: null },
    movement: {
      type: String,
      enum: Object.values(RankMovement),
      required: true,
      default: RankMovement.NEW,
    },
    rankDelta: { type: Number, required: true, default: 0 },
    pointsDelta: { type: Number, required: true, default: 0 },

    snapshotId: { type: Schema.Types.ObjectId, ref: 'LeaderboardSnapshot', default: null },
    capturedAt: { type: Date, required: true, default: () => new Date(), index: true },
  },
  { collection: 'rank_histories' },
);

// Latest history row for a `(scope, entry)` — hot path for "my rank now".
rankHistorySchema.index({ scope: 1, scopeId: 1, entryId: 1, capturedAt: -1 });
// User's full rank history for a contest or match (used by the My Rankings screen).
rankHistorySchema.index({ userId: 1, scope: 1, scopeId: 1, capturedAt: -1 });
// All movement for one user across matches (recent history widget).
rankHistorySchema.index({ userId: 1, capturedAt: -1 });

export const RankHistory: RankHistoryModel = model<IRankHistory>(
  'RankHistory',
  rankHistorySchema,
);

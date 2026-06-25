import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { MatchUpdateType } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Append-only `match_updates` stream.
 *
 * Every score-tick / status transition / event reported by a provider
 * lands here as an immutable row. The match doc carries the *latest*
 * snapshot for fast reads, but the full history lives here for:
 *
 *  - replay / commentary playback,
 *  - audit (settle contest disputes),
 *  - feeding the future socket pipeline (Phase 8).
 *
 * The `sequence` field is monotonically increasing per match — produced
 * by an atomic `$inc` on a per-match counter. Live-score updates that
 * arrive out of order are deduplicated by `(matchId, providerKey, providerEventId)`.
 */
export interface IMatchUpdate extends BaseDocFields {
  _id: Types.ObjectId;
  matchId: Types.ObjectId;
  type: MatchUpdateType;

  /** Monotonic position in the per-match stream (1, 2, 3, …). */
  sequence: number;

  /** Provider info — null for system / admin-generated events. */
  providerKey: string | null;
  providerEventId: string | null;

  /** Free-form event payload (score deltas, commentary text, etc.). */
  payload: Record<string, unknown>;

  /** Real-world timestamp the event happened (provider clock). */
  occurredAt: Date;
}

export type MatchUpdateDoc = HydratedDocument<IMatchUpdate>;
export type MatchUpdateModel = Model<IMatchUpdate>;

const matchUpdateSchema = createBaseSchema<IMatchUpdate>(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    type: { type: String, enum: Object.values(MatchUpdateType), required: true },

    sequence: { type: Number, required: true, min: 0 },

    providerKey: { type: String, default: null },
    providerEventId: { type: String, default: null },

    payload: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true },
  },
  { collection: 'match_updates' },
);

// Replay / pagination queries — match + ordered.
matchUpdateSchema.index({ matchId: 1, sequence: 1 });

// Idempotent ingestion: same provider event won't be inserted twice.
matchUpdateSchema.index(
  { matchId: 1, providerKey: 1, providerEventId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      providerKey: { $type: 'string' },
      providerEventId: { $type: 'string' },
    },
  },
);

export const MatchUpdate: MatchUpdateModel = model<IMatchUpdate>(
  'MatchUpdate',
  matchUpdateSchema,
);

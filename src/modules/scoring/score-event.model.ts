import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { ScoreEventStatus, ScoreEventType } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * `score_events` — append-only audit log of every scoring trigger.
 *
 * One row per recompute attempt. Captures **what** triggered it (live
 * tick / admin / rule change), **which** inputs were used (scoring rule
 * version, player-stats snapshot count), and **what** the outcome was
 * (teams updated, ms taken, error if any).
 *
 * This is the source of truth for "why does this fantasy team show 87
 * points?". The scoring engine itself is pure — every materialised
 * point breakdown can be traced back to a row here.
 *
 * Indexes:
 *  - `{ matchId, createdAt: -1 }` — list events per match, newest first
 *  - `{ status, createdAt: 1 }`   — worker scans pending events
 *  - `{ matchId, status }`        — "anything still in-flight for match X?"
 */
export interface IScoreEvent extends BaseDocFields {
  _id: Types.ObjectId;

  matchId: Types.ObjectId;
  /** Optional — set for per-player adjustments. */
  playerId: Types.ObjectId | null;

  type: ScoreEventType;
  status: ScoreEventStatus;

  /** Snapshot of the scoring rule version applied (audit). */
  scoringRuleId: Types.ObjectId | null;
  scoringRuleVersion: number | null;

  /** Number of `player_stats` rows the engine read. */
  inputRowsCount: number;
  /** Number of `fantasy_teams` whose totals changed. */
  teamsUpdatedCount: number;
  /** Number of distinct players whose `fantasyPoints` changed. */
  playersUpdatedCount: number;

  /** Free-form context: BullMQ jobId, admin reason, adjustment delta, etc. */
  context: Record<string, unknown>;

  /** Wall-clock duration of the engine pass. */
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;

  /** Set only when `status === FAILED`. */
  errorMessage: string | null;
  errorCode: string | null;

  /** Who triggered it — null for queue/cron-driven events. */
  triggeredBy: Types.ObjectId | null;
}

export type ScoreEventDoc = HydratedDocument<IScoreEvent>;
export type ScoreEventModel = Model<IScoreEvent>;

const scoreEventSchema = createBaseSchema<IScoreEvent>(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    playerId: { type: Schema.Types.ObjectId, ref: 'Player', default: null },

    type: {
      type: String,
      enum: Object.values(ScoreEventType),
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(ScoreEventStatus),
      required: true,
      default: ScoreEventStatus.PENDING,
      index: true,
    },

    scoringRuleId: {
      type: Schema.Types.ObjectId,
      ref: 'FantasyScoringRule',
      default: null,
    },
    scoringRuleVersion: { type: Number, default: null, min: 0 },

    inputRowsCount: { type: Number, required: true, default: 0, min: 0 },
    teamsUpdatedCount: { type: Number, required: true, default: 0, min: 0 },
    playersUpdatedCount: { type: Number, required: true, default: 0, min: 0 },

    context: { type: Schema.Types.Mixed, default: () => ({}) },

    startedAt: { type: Date, required: true, default: () => new Date() },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null, min: 0 },

    errorMessage: { type: String, default: null, maxlength: 2000 },
    errorCode: { type: String, default: null, maxlength: 64 },

    triggeredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'score_events' },
);

scoreEventSchema.index({ matchId: 1, createdAt: -1 });
scoreEventSchema.index({ status: 1, createdAt: 1 });
scoreEventSchema.index({ matchId: 1, status: 1 });

export const ScoreEvent: ScoreEventModel = model<IScoreEvent>('ScoreEvent', scoreEventSchema);

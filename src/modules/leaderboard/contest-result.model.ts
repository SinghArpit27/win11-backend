import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { ContestSettlementStatus } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * `contest_results` — one row per settled contest.
 *
 * Acts as the **settlement ledger** + cache:
 *   - Captures the final input pool, payouts, commission, winners.
 *   - Tracks settlement lifecycle (NOT_STARTED → IN_PROGRESS → SETTLED).
 *   - Makes settlement idempotent: the worker `findOneAndUpdate` flips
 *     status to IN_PROGRESS atomically and refuses to start again if
 *     someone else already did.
 *
 * One row per `contestId` — `unique` index enforces it.
 */
export interface IContestResultWinner {
  rank: number;
  entryId: Types.ObjectId;
  userId: Types.ObjectId;
  teamId: Types.ObjectId;
  points: number;
  winningAmount: number;
  /** Set to true when this entry was tied with another at the same score. */
  isTied: boolean;
}

export interface IContestResult extends BaseDocFields {
  _id: Types.ObjectId;

  contestId: Types.ObjectId;
  matchId: Types.ObjectId;

  status: ContestSettlementStatus;
  /** Last error message if `status === FAILED`. */
  errorMessage: string | null;

  /** Frozen prize pool that was actually distributed (minor units). */
  poolAmount: number;
  /** Sum of winningAmount across all entries (minor units). */
  totalPaidOut: number;
  /** Platform cut held back from the pool (minor units). */
  commissionAmount: number;
  currency: string;

  totalEntries: number;
  totalWinners: number;
  /** Highest score in the contest. */
  topScore: number;
  /** Number of distinct scores in the winning ranks (used for tie analysis). */
  uniqueWinningScores: number;

  /** Top-N preview for the result page (default 3 — same as snapshot). */
  topEntries: IContestResultWinner[];

  startedAt: Date | null;
  completedAt: Date | null;
  /** Wall-clock duration of the settlement run. */
  durationMs: number | null;

  /** Worker `lockToken` — used to detect orphaned settlements. */
  lockToken: string | null;
  /** Last admin to manually intervene with this settlement. */
  lastTouchedBy: Types.ObjectId | null;
}

export type ContestResultDoc = HydratedDocument<IContestResult>;
export type ContestResultModel = Model<IContestResult>;

const winnerSchema = new Schema<IContestResultWinner>(
  {
    rank: { type: Number, required: true, min: 1 },
    entryId: { type: Schema.Types.ObjectId, ref: 'ContestEntry', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'FantasyTeam', required: true },
    points: { type: Number, required: true },
    winningAmount: { type: Number, required: true, min: 0 },
    isTied: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const contestResultSchema = createBaseSchema<IContestResult>(
  {
    contestId: {
      type: Schema.Types.ObjectId,
      ref: 'Contest',
      required: true,
      unique: true,
      index: true,
    },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },

    status: {
      type: String,
      enum: Object.values(ContestSettlementStatus),
      required: true,
      default: ContestSettlementStatus.NOT_STARTED,
      index: true,
    },
    errorMessage: { type: String, default: null, maxlength: 2000 },

    poolAmount: { type: Number, required: true, default: 0, min: 0 },
    totalPaidOut: { type: Number, required: true, default: 0, min: 0 },
    commissionAmount: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true, maxlength: 3 },

    totalEntries: { type: Number, required: true, default: 0, min: 0 },
    totalWinners: { type: Number, required: true, default: 0, min: 0 },
    topScore: { type: Number, required: true, default: 0 },
    uniqueWinningScores: { type: Number, required: true, default: 0, min: 0 },

    topEntries: { type: [winnerSchema], required: true, default: [] },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null, min: 0 },

    lockToken: { type: String, default: null, maxlength: 80 },
    lastTouchedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'contest_results' },
);

contestResultSchema.index({ matchId: 1, status: 1 });
contestResultSchema.index({ status: 1, startedAt: 1 });

export const ContestResult: ContestResultModel = model<IContestResult>(
  'ContestResult',
  contestResultSchema,
);

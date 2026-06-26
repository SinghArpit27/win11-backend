import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import {
  ContestStatus,
  ContestType,
  ContestVisibility,
  MatchFormat,
  PrizeDistributionType,
  Sport,
} from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Canonical `contests` collection.
 *
 * One contest row per `(match, blueprint)` instance. Contests carry a
 * **frozen snapshot** of the prize distribution at create time so admin
 * edits to the template never silently mutate live contests.
 *
 * Concurrency design (see `contest-join.service.ts`):
 *  - `filledSpots` is incremented atomically with `$inc` inside the
 *    join transaction; this is the canonical "is the contest full?"
 *    check, never `entries.length`.
 *  - `version` is a monotonically-increasing optimistic-lock counter
 *    bumped by every join. The frontend uses it to detect stale
 *    contest detail snapshots when the user is sitting on the join
 *    confirmation screen.
 *
 * `currency` is denormalised onto the contest so wallet-currency
 * validation is a single field lookup (no template join). Keep this
 * in sync with the embedded snapshots.
 */
export interface IContestPrizeSlabSnapshot {
  fromRank: number;
  toRank: number;
  prizeAmount: number;
  percentageBps: number;
  bonusLabel: string | null;
}

export interface IContestPrizeSnapshot {
  /** Reference to the source `prize_distributions` row (audit only). */
  distributionId: Types.ObjectId | null;
  name: string;
  type: PrizeDistributionType;
  /** Pool the slabs were authored against (minor units). */
  poolAmount: number;
  slabs: IContestPrizeSlabSnapshot[];
  maxWinningRank: number;
}

export interface IContest extends BaseDocFields {
  _id: Types.ObjectId;

  // ── Identity ──────────────────────────────────────────────────────
  matchId: Types.ObjectId;
  sport: Sport;
  format: MatchFormat;
  name: string;
  description: string | null;

  // ── Classification ────────────────────────────────────────────────
  type: ContestType;
  visibility: ContestVisibility;
  /** Set for HEAD_TO_HEAD and PRIVATE contests; null otherwise. */
  inviteCode: string | null;

  // ── Lifecycle ─────────────────────────────────────────────────────
  status: ContestStatus;
  /** Inclusive window during which joins are accepted. Both fields are
   *  set when the contest is published; LOCKED transitions when
   *  `match.lineupLockedAt` (or `closesAt`) passes. */
  joinOpensAt: Date | null;
  joinClosesAt: Date | null;
  publishedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  /** Optional non-cash flag for PRACTICE contests. */
  isPractice: boolean;
  /** True ⇒ admin guarantees the prize pool regardless of fill. */
  isGuaranteed: boolean;

  // ── Money (all values in MINOR units) ────────────────────────────
  entryFee: number;
  prizePoolAmount: number;
  currency: string;

  // ── Capacity / fill ──────────────────────────────────────────────
  totalSpots: number;
  filledSpots: number;
  maxEntriesPerUser: number;

  // ── Prize snapshot ───────────────────────────────────────────────
  prizeSnapshot: IContestPrizeSnapshot;

  // ── Audit / lineage ──────────────────────────────────────────────
  templateId: Types.ObjectId | null;
  /** Set if this contest was created via Clone — points at the source. */
  clonedFromId: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  cancelledBy: Types.ObjectId | null;

  // ── Concurrency / cache ──────────────────────────────────────────
  /** Optimistic lock — bumped every state mutation. */
  version: number;
  /** Wall-clock of the last filled-spot increment (for hot-cache TTLs). */
  lastJoinedAt: Date | null;
  /** Used by analytics — how many distinct users joined. Denormalised
   *  to dodge a count-distinct on `contest_entries`. */
  distinctParticipantsCount: number;
}

export type ContestDoc = HydratedDocument<IContest>;
export type ContestModel = Model<IContest>;

const prizeSlabSnapshotSchema = new Schema<IContestPrizeSlabSnapshot>(
  {
    fromRank: { type: Number, required: true, min: 1 },
    toRank: { type: Number, required: true, min: 1 },
    prizeAmount: { type: Number, required: true, default: 0, min: 0 },
    percentageBps: { type: Number, required: true, default: 0, min: 0, max: 10_000 },
    bonusLabel: { type: String, default: null },
  },
  { _id: false },
);

const prizeSnapshotSchema = new Schema<IContestPrizeSnapshot>(
  {
    distributionId: { type: Schema.Types.ObjectId, ref: 'PrizeDistribution', default: null },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: {
      type: String,
      enum: Object.values(PrizeDistributionType),
      required: true,
    },
    poolAmount: { type: Number, required: true, min: 0 },
    slabs: { type: [prizeSlabSnapshotSchema], required: true, default: [] },
    maxWinningRank: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const contestSchema = createBaseSchema<IContest>(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    sport: { type: String, enum: Object.values(Sport), required: true, index: true },
    format: { type: String, enum: Object.values(MatchFormat), required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
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
      index: true,
    },
    inviteCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 24,
      // Sparse + unique — omit the field on public contests (never store null).
      index: { unique: true, sparse: true },
    },

    status: {
      type: String,
      enum: Object.values(ContestStatus),
      required: true,
      default: ContestStatus.DRAFT,
      index: true,
    },
    joinOpensAt: { type: Date, default: null },
    joinClosesAt: { type: Date, default: null, index: true },
    publishedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: null, maxlength: 500 },
    isPractice: { type: Boolean, required: true, default: false },
    isGuaranteed: { type: Boolean, required: true, default: false },

    entryFee: { type: Number, required: true, min: 0 },
    prizePoolAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true, maxlength: 3 },

    totalSpots: { type: Number, required: true, min: 2 },
    filledSpots: { type: Number, required: true, default: 0, min: 0 },
    maxEntriesPerUser: { type: Number, required: true, default: 1, min: 1 },

    prizeSnapshot: { type: prizeSnapshotSchema, required: true },

    templateId: {
      type: Schema.Types.ObjectId,
      ref: 'ContestTemplate',
      default: null,
      index: true,
    },
    clonedFromId: { type: Schema.Types.ObjectId, ref: 'Contest', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    version: { type: Number, required: true, default: 0 },
    lastJoinedAt: { type: Date, default: null },
    distinctParticipantsCount: { type: Number, required: true, default: 0, min: 0 },
  },
  { collection: 'contests' },
);

// ── Hot read patterns ─────────────────────────────────────────────────
//  - User list for a match (filter on status + sort by entryFee/prizePool):
contestSchema.index({ matchId: 1, status: 1, entryFee: 1 });
contestSchema.index({ matchId: 1, status: 1, prizePoolAmount: -1 });
contestSchema.index({ matchId: 1, type: 1, status: 1 });
//  - Admin global list:
contestSchema.index({ status: 1, joinClosesAt: 1 });
//  - "Find contests transitioning to LOCKED soon":
contestSchema.index({ status: 1, joinClosesAt: 1, sport: 1 });

export const Contest: ContestModel = model<IContest>('Contest', contestSchema);

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { ContestEntryStatus } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * `contest_entries` collection — one row per `(contest, team)` join.
 *
 * Concurrency invariants:
 *  - **Duplicate prevention**: unique partial index on
 *    `(contestId, teamId)` (only for non-CANCELLED rows) prevents
 *    a user from joining the same contest with the same team twice
 *    even under parallel requests.
 *  - **User-entry-limit enforcement**: the join service counts ACTIVE
 *    entries for `(contestId, userId)` *inside* the transaction;
 *    the count + the limit check is the source of truth, the
 *    unique index is the defensive net.
 *  - **Wallet wiring**: every entry stores `walletTransactionId`
 *    pointing to the LOCK transaction. Refunds set `refundedAt`
 *    and link `refundTransactionId` for full traceability.
 *
 * `entryNumber` (1..maxEntriesPerUser) is denormalised so the FE can
 * show "Team 1 / Team 4" labels without a count() round-trip.
 *
 * `rank` / `winningAmount` are reserved for Phase 7 settlement — wired
 * here so the settlement code never needs to migrate the schema.
 */
export interface IContestEntry extends BaseDocFields {
  _id: Types.ObjectId;

  contestId: Types.ObjectId;
  userId: Types.ObjectId;
  matchId: Types.ObjectId;
  /** Fantasy team this entry was submitted with. */
  teamId: Types.ObjectId;

  /** Snapshot to dodge a JOIN on the contest at read time. */
  entryFee: number;
  currency: string;
  /** N-th entry for this `(user, contest)` pair — 1-based. */
  entryNumber: number;

  status: ContestEntryStatus;

  /** Idempotency key used by the join request — reused as the wallet
   *  idempotency key so retries by the same client de-dupe cleanly. */
  idempotencyKey: string | null;

  /** Pointer at the wallet LOCK transaction. */
  walletTransactionId: Types.ObjectId | null;
  /** Pointer at the wallet REFUND transaction (when status === REFUNDED). */
  refundTransactionId: Types.ObjectId | null;
  refundedAt: Date | null;
  refundReason: string | null;

  /** Reserved for Phase 7 — settlement fields. */
  rank: number | null;
  winningAmount: number;
  settledAt: Date | null;

  joinedAt: Date;
}

export type ContestEntryDoc = HydratedDocument<IContestEntry>;
export type ContestEntryModel = Model<IContestEntry>;

const contestEntrySchema = createBaseSchema<IContestEntry>(
  {
    contestId: { type: Schema.Types.ObjectId, ref: 'Contest', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'FantasyTeam', required: true, index: true },

    entryFee: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true, maxlength: 3 },
    entryNumber: { type: Number, required: true, default: 1, min: 1 },

    status: {
      type: String,
      enum: Object.values(ContestEntryStatus),
      required: true,
      default: ContestEntryStatus.ACTIVE,
      index: true,
    },

    idempotencyKey: { type: String, default: null, trim: true, maxlength: 80 },

    walletTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    refundTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    refundedAt: { type: Date, default: null },
    refundReason: { type: String, default: null, maxlength: 500 },

    rank: { type: Number, default: null, min: 1 },
    winningAmount: { type: Number, required: true, default: 0, min: 0 },
    settledAt: { type: Date, default: null },

    joinedAt: { type: Date, required: true, default: () => new Date(), index: true },
  },
  { collection: 'contest_entries' },
);

// ── Concurrency-safe duplicate prevention ─────────────────────────────
// One ACTIVE row per `(contest, team)` — the join service short-circuits
// on this before consuming a spot. Sparse so CANCELLED / REFUNDED rows
// don't block legitimate re-joins of the same team (rare, but possible
// after a refund + re-open scenario).
contestEntrySchema.index(
  { contestId: 1, teamId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: [ContestEntryStatus.ACTIVE] } },
    name: 'contest_team_active_unique',
  },
);

// ── Idempotency ───────────────────────────────────────────────────────
contestEntrySchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    name: 'user_idempotency_unique',
  },
);

// ── Hot read patterns ─────────────────────────────────────────────────
//  - My contests by user (paginated list)
contestEntrySchema.index({ userId: 1, joinedAt: -1 });
//  - User's entries within a single contest (entry counter + my-teams view)
contestEntrySchema.index({ contestId: 1, userId: 1, status: 1 });
//  - Settlement scan
contestEntrySchema.index({ contestId: 1, status: 1, rank: 1 });
//  - User's entries for a specific match (used by the match-detail "my contests" widget)
contestEntrySchema.index({ userId: 1, matchId: 1, status: 1 });

export const ContestEntry: ContestEntryModel = model<IContestEntry>(
  'ContestEntry',
  contestEntrySchema,
);

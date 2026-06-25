import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { MatchFormat, MatchStatus, Sport } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Canonical `matches` collection.
 *
 * The match is the unit of contest creation and the central read-heavy
 * entity in the platform. Every match has:
 *
 *  - exactly two teams (home + away),
 *  - a tournament + format,
 *  - a status machine: UPCOMING → LIVE → COMPLETED / CANCELLED / ABANDONED,
 *  - a denormalised score snapshot for fast list rendering,
 *  - a lineup-locked timestamp used by the contest engine to freeze entries
 *    once the toss / starting XI is announced.
 *
 * Live scores are not stored on the match itself — they live in the
 * append-only `match_updates` collection. The `scores` field here is the
 * *latest snapshot* maintained by the live-score worker for fast reads.
 */
export interface IMatchExternalId {
  providerKey: string;
  id: string;
}

/**
 * Compact per-team score snapshot. Sport-shape varies (cricket has runs +
 * wickets + overs, football has goals); the snapshot stays loosely typed
 * so each sport can populate what makes sense without an explosion of
 * sub-schemas.
 */
export interface IMatchTeamScore {
  teamId: Types.ObjectId;
  /** Primary scoring metric ("runs", "goals", "points"). */
  score: number;
  /** Secondary metric ("wickets", "fouls"). Optional. */
  secondary: number | null;
  /** Overs / quarter / period etc., as a free-form short string. */
  overs: string | null;
}

export interface IMatchVenue {
  name: string | null;
  city: string | null;
  country: string | null;
}

export interface IMatch extends BaseDocFields {
  _id: Types.ObjectId;

  sport: Sport;
  format: MatchFormat;

  tournamentId: Types.ObjectId;
  homeTeamId: Types.ObjectId;
  awayTeamId: Types.ObjectId;

  status: MatchStatus;

  /** ISO timestamp the match is scheduled to start. */
  scheduledAt: Date;
  /** Set when the match actually starts (status → LIVE). */
  startedAt: Date | null;
  /** Set when the match ends (COMPLETED / CANCELLED / ABANDONED). */
  completedAt: Date | null;
  /** When team lineups freeze (contest entry-cutoff). */
  lineupLockedAt: Date | null;

  venue: IMatchVenue;

  /** Latest score snapshot per side. Recomputed on every live update. */
  scores: IMatchTeamScore[];

  /** Free-form short outcome string ("MI won by 5 wickets"). */
  resultSummary: string | null;
  /** Winner's team id (when determinable). null for draws / cancelled. */
  winnerTeamId: Types.ObjectId | null;
  /** Toss outcome — cricket-only. Optional for other sports. */
  tossWinnerTeamId: Types.ObjectId | null;
  tossDecision: 'BAT' | 'BOWL' | null;

  /** Manually toggled by admins for the "Featured" home-screen rail. */
  isFeatured: boolean;
  /** Auto-computed from view count + contest joins. */
  popularityScore: number;
  /** Aggregate non-unique view counter for the trending sort. */
  viewCount: number;

  externalIds: IMatchExternalId[];
  /** Provider-side season key for fast filtered re-fetches. */
  providerSeasonKey: string | null;

  lastSyncedAt: Date | null;
  /** Last live-score update — drives stale-data badges in the UI. */
  lastUpdateAt: Date | null;
}

export type MatchDoc = HydratedDocument<IMatch>;
export type MatchModel = Model<IMatch>;

const teamScoreSchema = new Schema<IMatchTeamScore>(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    score: { type: Number, default: 0, min: 0 },
    secondary: { type: Number, default: null },
    overs: { type: String, default: null, maxlength: 16 },
  },
  { _id: false },
);

const matchSchema = createBaseSchema<IMatch>(
  {
    sport: { type: String, enum: Object.values(Sport), required: true, index: true },
    format: {
      type: String,
      enum: Object.values(MatchFormat),
      default: MatchFormat.STANDARD,
      required: true,
    },

    tournamentId: {
      type: Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true,
      index: true,
    },
    homeTeamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    awayTeamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },

    status: {
      type: String,
      enum: Object.values(MatchStatus),
      default: MatchStatus.UPCOMING,
      required: true,
      index: true,
    },

    scheduledAt: { type: Date, required: true, index: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lineupLockedAt: { type: Date, default: null },

    venue: {
      type: new Schema<IMatchVenue>(
        {
          name: { type: String, default: null, maxlength: 200 },
          city: { type: String, default: null, maxlength: 120 },
          country: { type: String, default: null, uppercase: true, maxlength: 8 },
        },
        { _id: false },
      ),
      default: () => ({ name: null, city: null, country: null }),
    },

    scores: { type: [teamScoreSchema], default: [] },

    resultSummary: { type: String, default: null, maxlength: 280 },
    winnerTeamId: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
    tossWinnerTeamId: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
    tossDecision: { type: String, enum: ['BAT', 'BOWL', null], default: null },

    isFeatured: { type: Boolean, default: false, index: true },
    popularityScore: { type: Number, default: 0, min: 0, index: true },
    viewCount: { type: Number, default: 0, min: 0 },

    externalIds: {
      type: [
        new Schema<IMatchExternalId>(
          {
            providerKey: { type: String, required: true },
            id: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    providerSeasonKey: { type: String, default: null, index: true },

    lastSyncedAt: { type: Date, default: null },
    lastUpdateAt: { type: Date, default: null },
  },
  { collection: 'matches' },
);

// ─── Indexes ────────────────────────────────────────────────────────────────
// Composite indexes mirror the access patterns the controllers run:

// 1. "Upcoming matches for sport, soonest first" — home screen rail.
matchSchema.index({ sport: 1, status: 1, scheduledAt: 1 });

// 2. "Featured matches for sport" — featured rail.
matchSchema.index({ sport: 1, isFeatured: 1, scheduledAt: 1 });

// 3. "Tournament fixtures sorted by date" — tournament detail.
matchSchema.index({ tournamentId: 1, scheduledAt: 1 });

// 4. "Trending matches" — popularity-sorted.
matchSchema.index({ status: 1, popularityScore: -1 });

// 5. Idempotent provider upserts.
matchSchema.index({ 'externalIds.providerKey': 1, 'externalIds.id': 1 });

// Virtual for the convenience "isLive" boolean used in serializers.
matchSchema.virtual('isLive').get(function (this: IMatch) {
  return this.status === MatchStatus.LIVE;
});

export const Match: MatchModel = model<IMatch>('Match', matchSchema);

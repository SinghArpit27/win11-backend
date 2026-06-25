import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { FantasyTeamStatus, MatchFormat, PlayerRole, Sport } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Canonical `fantasy_teams` collection.
 *
 * One row per *finalised* user team. Drafts (in-progress) live in
 * `fantasy_team_drafts` so we can keep this collection lean and indexed
 * for the leaderboard pipeline.
 *
 * Players are stored as an embedded subdoc array because the create /
 * read / preview paths always load all 11 together — a `$lookup` would
 * be wasted overhead. A separate `fantasy_team_players` projection
 * mirrors the same data flattened for analytics (`how many users picked
 * player X for match M?`).
 */
export interface IFantasyTeamPlayer {
  playerId: Types.ObjectId;
  /** Snapshot of the player's role at team-save time — protects against
   *  upstream role changes invalidating saved teams. */
  role: PlayerRole;
  /** Snapshot of the team the player belonged to at team-save time. */
  teamId: Types.ObjectId;
  /** Snapshot of credits used at team-save time. */
  credits: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
}

export interface IFantasyTeam extends BaseDocFields {
  _id: Types.ObjectId;

  userId: Types.ObjectId;
  matchId: Types.ObjectId;
  sport: Sport;
  format: MatchFormat;

  /** Snapshot of the rule version this team was built against. */
  ruleId: Types.ObjectId;
  ruleVersion: number;

  name: string;
  /** Optional emoji / hex shown next to the name in the my-teams list. */
  accentColor: string | null;

  status: FantasyTeamStatus;
  /** Latched when the underlying match crosses `lineupLockedAt`. */
  lockedAt: Date | null;

  /** Embedded roster — 11 entries by default (rule-driven). */
  players: IFantasyTeamPlayer[];

  /** Sum of `players[i].credits`. Denormalised for fast list rendering. */
  totalCreditsUsed: number;

  /** Convenience accessors — also stored as flags on `players[]`. */
  captainPlayerId: Types.ObjectId;
  viceCaptainPlayerId: Types.ObjectId;

  /**
   * Composition by role — `{ BATSMAN: 4, BOWLER: 3, ... }`.
   * Stored so the leaderboard pipeline doesn't need to map over players.
   */
  roleBreakdown: Record<string, number>;

  /** Composition by real-world team — `{ [teamId]: count }`. */
  teamBreakdown: Record<string, number>;

  /** Phase-7 fields — wired now so consumers don't churn. */
  totalPoints: number;
  pointsBreakdown: {
    batting: number;
    bowling: number;
    fielding: number;
    bonus: number;
    penalty: number;
  };
  pointsLastComputedAt: Date | null;
}

export type FantasyTeamDoc = HydratedDocument<IFantasyTeam>;
export type FantasyTeamModel = Model<IFantasyTeam>;

const fantasyTeamPlayerSchema = new Schema<IFantasyTeamPlayer>(
  {
    playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
    role: { type: String, enum: Object.values(PlayerRole), required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    credits: { type: Number, required: true, min: 0, max: 100 },
    isCaptain: { type: Boolean, required: true, default: false },
    isViceCaptain: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const fantasyTeamSchema = createBaseSchema<IFantasyTeam>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    sport: { type: String, enum: Object.values(Sport), required: true, index: true },
    format: { type: String, enum: Object.values(MatchFormat), required: true },

    ruleId: { type: Schema.Types.ObjectId, ref: 'FantasyRule', required: true },
    ruleVersion: { type: Number, required: true, min: 1 },

    name: { type: String, required: true, trim: true, maxlength: 60 },
    accentColor: { type: String, default: null, trim: true, maxlength: 32 },

    status: {
      type: String,
      enum: Object.values(FantasyTeamStatus),
      required: true,
      default: FantasyTeamStatus.EDITABLE,
      index: true,
    },
    lockedAt: { type: Date, default: null },

    players: {
      type: [fantasyTeamPlayerSchema],
      required: true,
      default: [],
      validate: {
        validator: (arr: IFantasyTeamPlayer[]) => arr.length > 0 && arr.length <= 30,
        message: 'A fantasy team must have between 1 and 30 players',
      },
    },

    totalCreditsUsed: { type: Number, required: true, default: 0, min: 0 },

    captainPlayerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
    viceCaptainPlayerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },

    roleBreakdown: { type: Schema.Types.Mixed, default: {} },
    teamBreakdown: { type: Schema.Types.Mixed, default: {} },

    totalPoints: { type: Number, default: 0, index: true },
    pointsBreakdown: {
      batting: { type: Number, default: 0 },
      bowling: { type: Number, default: 0 },
      fielding: { type: Number, default: 0 },
      bonus: { type: Number, default: 0 },
      penalty: { type: Number, default: 0 },
    },
    pointsLastComputedAt: { type: Date, default: null },
  },
  { collection: 'fantasy_teams' },
);

// Hot read patterns:
//  - my-teams for a match     → (userId, matchId, isDeleted)
//  - leaderboard for a match  → (matchId, status, totalPoints desc)
//  - aggregates per user      → (userId, createdAt desc)
fantasyTeamSchema.index({ userId: 1, matchId: 1, isDeleted: 1 });
fantasyTeamSchema.index({ matchId: 1, status: 1, totalPoints: -1 });
fantasyTeamSchema.index({ userId: 1, createdAt: -1 });
fantasyTeamSchema.index({ matchId: 1, userId: 1, name: 1 });

export const FantasyTeam: FantasyTeamModel = model<IFantasyTeam>(
  'FantasyTeam',
  fantasyTeamSchema,
);

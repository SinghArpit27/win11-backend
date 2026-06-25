import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { AppConstants } from '@common/constants/app.constants';
import { MatchFormat, PlayerRole, Sport } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * In-progress fantasy team being built by the user.
 *
 * Decoupled from `FantasyTeam` so:
 *  - the drafts collection can be aggressively TTL'd (auto-cleanup),
 *  - the finalised teams collection stays lean for the leaderboard,
 *  - the validator can run on a partial state without polluting the
 *    saved-teams query plans.
 *
 * One draft per (userId, matchId, clientDraftId) — the optional
 * `clientDraftId` lets a user keep multiple in-flight drafts for the
 * same match (e.g. exploring two team variants from different tabs).
 */
export interface IFantasyDraftPlayer {
  playerId: Types.ObjectId;
  role: PlayerRole;
  teamId: Types.ObjectId | null;
  credits: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
}

export interface IFantasyTeamDraft extends BaseDocFields {
  _id: Types.ObjectId;

  userId: Types.ObjectId;
  matchId: Types.ObjectId;
  sport: Sport;
  format: MatchFormat;

  /**
   * Opaque client-supplied id (UUID v4 recommended). Lets a single user
   * keep multiple in-flight drafts. `null` = the user's default draft
   * slot for the match.
   */
  clientDraftId: string | null;

  ruleId: Types.ObjectId | null;
  ruleVersion: number | null;

  /** Display name — defaults to "Team {n}" until the user types one. */
  name: string;

  players: IFantasyDraftPlayer[];

  totalCreditsUsed: number;
  captainPlayerId: Types.ObjectId | null;
  viceCaptainPlayerId: Types.ObjectId | null;

  /** Updated on every save — drives the TTL index below. */
  lastEditedAt: Date;
}

export type FantasyTeamDraftDoc = HydratedDocument<IFantasyTeamDraft>;
export type FantasyTeamDraftModel = Model<IFantasyTeamDraft>;

const fantasyDraftPlayerSchema = new Schema<IFantasyDraftPlayer>(
  {
    playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
    role: { type: String, enum: Object.values(PlayerRole), required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
    credits: { type: Number, required: true, min: 0, max: 100 },
    isCaptain: { type: Boolean, required: true, default: false },
    isViceCaptain: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const fantasyTeamDraftSchema = createBaseSchema<IFantasyTeamDraft>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    sport: { type: String, enum: Object.values(Sport), required: true },
    format: { type: String, enum: Object.values(MatchFormat), required: true },

    clientDraftId: { type: String, default: null, trim: true, maxlength: 64 },

    ruleId: { type: Schema.Types.ObjectId, ref: 'FantasyRule', default: null },
    ruleVersion: { type: Number, default: null, min: 1 },

    name: { type: String, required: true, default: 'Draft team', trim: true, maxlength: 60 },

    players: { type: [fantasyDraftPlayerSchema], required: true, default: [] },

    totalCreditsUsed: { type: Number, required: true, default: 0, min: 0 },
    captainPlayerId: { type: Schema.Types.ObjectId, ref: 'Player', default: null },
    viceCaptainPlayerId: { type: Schema.Types.ObjectId, ref: 'Player', default: null },

    lastEditedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'fantasy_team_drafts' },
);

// Unique slot per (user, match, clientDraftId). `clientDraftId` null is
// allowed and counts as the default slot.
fantasyTeamDraftSchema.index(
  { userId: 1, matchId: 1, clientDraftId: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
    name: 'fantasy_team_drafts_one_per_slot',
  },
);
fantasyTeamDraftSchema.index({ userId: 1, lastEditedAt: -1 });
// TTL — drafts older than `DRAFT_TTL_SECONDS` are auto-purged.
fantasyTeamDraftSchema.index(
  { lastEditedAt: 1 },
  { expireAfterSeconds: AppConstants.FANTASY.DRAFT_TTL_SECONDS },
);

export const FantasyTeamDraft: FantasyTeamDraftModel = model<IFantasyTeamDraft>(
  'FantasyTeamDraft',
  fantasyTeamDraftSchema,
);

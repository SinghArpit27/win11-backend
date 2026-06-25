import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { PlayerRole, Sport } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Flattened projection of `FantasyTeam.players[]`.
 *
 * Why a separate collection? Two access patterns are wildly different:
 *  - "give me my team to render" → loads the whole doc, embedded array
 *    is perfect.
 *  - "for match M, how many users picked player X?" → needs a per-row
 *    index on (matchId, playerId). A `$lookup`/`$unwind` over the
 *    embedded array on every leaderboard refresh would be 10–100x
 *    slower than a covered count on this projection.
 *
 * The fantasy-team service writes both this projection and the canonical
 * team document inside the same MongoDB transaction. If the projection
 * write fails the team write also rolls back — the two never diverge.
 */
export interface IFantasyTeamPlayerRow extends BaseDocFields {
  _id: Types.ObjectId;

  fantasyTeamId: Types.ObjectId;
  userId: Types.ObjectId;
  matchId: Types.ObjectId;
  sport: Sport;

  playerId: Types.ObjectId;
  teamId: Types.ObjectId;
  role: PlayerRole;
  credits: number;

  isCaptain: boolean;
  isViceCaptain: boolean;

  /** Mirrors `FantasyTeam.totalPoints` for this player's contribution. */
  pointsEarned: number;
  pointsLastComputedAt: Date | null;
}

export type FantasyTeamPlayerDoc = HydratedDocument<IFantasyTeamPlayerRow>;
export type FantasyTeamPlayerModel = Model<IFantasyTeamPlayerRow>;

const fantasyTeamPlayerSchema = createBaseSchema<IFantasyTeamPlayerRow>(
  {
    fantasyTeamId: {
      type: Schema.Types.ObjectId,
      ref: 'FantasyTeam',
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    sport: { type: String, enum: Object.values(Sport), required: true },

    playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    role: { type: String, enum: Object.values(PlayerRole), required: true },
    credits: { type: Number, required: true, min: 0, max: 100 },

    isCaptain: { type: Boolean, required: true, default: false },
    isViceCaptain: { type: Boolean, required: true, default: false },

    pointsEarned: { type: Number, default: 0 },
    pointsLastComputedAt: { type: Date, default: null },
  },
  { collection: 'fantasy_team_players' },
);

// Same `fantasyTeamId` row must never duplicate a `playerId`.
fantasyTeamPlayerSchema.index(
  { fantasyTeamId: 1, playerId: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
    name: 'fantasy_team_players_unique_player_per_team',
  },
);
// Hot analytics paths.
fantasyTeamPlayerSchema.index({ matchId: 1, playerId: 1, isDeleted: 1 });
fantasyTeamPlayerSchema.index({ matchId: 1, isCaptain: 1, isDeleted: 1 });
fantasyTeamPlayerSchema.index({ matchId: 1, isViceCaptain: 1, isDeleted: 1 });
fantasyTeamPlayerSchema.index({ userId: 1, matchId: 1, isDeleted: 1 });

export const FantasyTeamPlayer: FantasyTeamPlayerModel = model<IFantasyTeamPlayerRow>(
  'FantasyTeamPlayer',
  fantasyTeamPlayerSchema,
);

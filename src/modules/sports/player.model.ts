import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { AppConstants } from '@common/constants/app.constants';
import { PlayerRole, Sport } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Canonical `players` collection.
 *
 * One row per real-world player. The fantasy contest engine references
 * players by `_id`; provider-side identifiers live on `externalIds`.
 *
 * Team affiliation is captured as the player's *current* team (denormalised
 * for fast match-lineup queries). Historical team changes go through the
 * `players_history` collection — out of scope for Phase 4.
 */
export interface IPlayerExternalId {
  providerKey: string;
  id: string;
}

export interface IPlayer extends BaseDocFields {
  _id: Types.ObjectId;

  sport: Sport;
  name: string;
  /** Short / display name used on compact cards (e.g. "V. Kohli"). */
  shortName: string | null;

  /** Coarse fantasy role used by contest team construction. */
  role: PlayerRole;
  /** Sport-specific free-form position label (e.g. "Right Wing"). */
  position: string | null;

  /** Current team. Soft-link — players can swap teams; sync rewrites this. */
  teamId: Types.ObjectId | null;

  /** ISO country / nationality. */
  country: string | null;
  /** Optional batting / bowling / playing style — cricket-only at first. */
  battingStyle: string | null;
  bowlingStyle: string | null;
  /** Jersey / shirt number, when known. */
  jerseyNumber: number | null;
  /** Date of birth — used for age display + age-restricted contests. */
  dateOfBirth: Date | null;

  photoUrl: string | null;

  /** Whether the player is currently active (not retired / banned). */
  isActive: boolean;

  /**
   * Default credit value used by the fantasy team builder when no match-
   * specific override exists. Stored as a decimal so admins can use
   * half-point increments (e.g. 8.5). PHASE 5.
   */
  baseCredits: number;

  externalIds: IPlayerExternalId[];
  lastSyncedAt: Date | null;
}

export type PlayerDoc = HydratedDocument<IPlayer>;
export type PlayerModel = Model<IPlayer>;

const playerSchema = createBaseSchema<IPlayer>(
  {
    sport: { type: String, enum: Object.values(Sport), required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    shortName: { type: String, default: null, trim: true, maxlength: 80 },

    role: {
      type: String,
      enum: Object.values(PlayerRole),
      default: PlayerRole.UNKNOWN,
      required: true,
      index: true,
    },
    position: { type: String, default: null, trim: true, maxlength: 80 },

    teamId: { type: Schema.Types.ObjectId, ref: 'Team', default: null, index: true },

    country: { type: String, default: null, trim: true, uppercase: true, maxlength: 8 },
    battingStyle: { type: String, default: null, trim: true, maxlength: 64 },
    bowlingStyle: { type: String, default: null, trim: true, maxlength: 64 },
    jerseyNumber: { type: Number, default: null, min: 0, max: 999 },
    dateOfBirth: { type: Date, default: null },

    photoUrl: { type: String, default: null, maxlength: 1024 },

    isActive: { type: Boolean, default: true, required: true, index: true },

    baseCredits: {
      type: Number,
      required: true,
      default: AppConstants.FANTASY.DEFAULT_PLAYER_BASE_CREDITS,
      min: 0,
      max: 50,
    },

    externalIds: {
      type: [
        new Schema<IPlayerExternalId>(
          {
            providerKey: { type: String, required: true },
            id: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    lastSyncedAt: { type: Date, default: null },
  },
  { collection: 'players' },
);

playerSchema.index({ sport: 1, isActive: 1 });
playerSchema.index({ teamId: 1, sport: 1 });
playerSchema.index({ 'externalIds.providerKey': 1, 'externalIds.id': 1 });
playerSchema.index({ name: 'text', shortName: 'text' });

export const Player: PlayerModel = model<IPlayer>('Player', playerSchema);

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { Sport } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Canonical `teams` collection.
 *
 * One row per team across every tournament — a team that plays in multiple
 * competitions (e.g. national side in T20 + ODI) is the SAME row. Tournament
 * affiliation is recorded on the match, not on the team.
 *
 * External IDs follow the same `(providerKey, id)` shape as `Tournament`
 * so upserts collapse on the natural provider key.
 */
export interface ITeamExternalId {
  providerKey: string;
  id: string;
}

export interface ITeam extends BaseDocFields {
  _id: Types.ObjectId;

  sport: Sport;
  name: string;
  /** 3–4 char display code (e.g. "MI", "RCB", "MAN", "ARG"). */
  shortName: string;
  /** Optional UN-M49 / ISO-3 country code. */
  country: string | null;

  logoUrl: string | null;
  /** Hex brand colours used for card gradients / chip backgrounds. */
  primaryColor: string | null;
  secondaryColor: string | null;

  /** Free-form taxonomy slugs (e.g. ["franchise", "ipl"]). */
  tags: string[];

  externalIds: ITeamExternalId[];
  lastSyncedAt: Date | null;
}

export type TeamDoc = HydratedDocument<ITeam>;
export type TeamModel = Model<ITeam>;

const teamSchema = createBaseSchema<ITeam>(
  {
    sport: { type: String, enum: Object.values(Sport), required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    shortName: { type: String, required: true, trim: true, uppercase: true, maxlength: 16 },
    country: { type: String, default: null, trim: true, uppercase: true, maxlength: 8 },

    logoUrl: { type: String, default: null, maxlength: 1024 },
    primaryColor: { type: String, default: null, maxlength: 16 },
    secondaryColor: { type: String, default: null, maxlength: 16 },

    tags: { type: [String], default: [] },

    externalIds: {
      type: [
        new Schema<ITeamExternalId>(
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
  { collection: 'teams' },
);

teamSchema.index({ sport: 1, shortName: 1 });
teamSchema.index({ 'externalIds.providerKey': 1, 'externalIds.id': 1 });
teamSchema.index({ name: 'text', shortName: 'text' });

export const Team: TeamModel = model<ITeam>('Team', teamSchema);

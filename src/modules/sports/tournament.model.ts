import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { Sport, TournamentStatus } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Canonical `tournaments` collection.
 *
 * A tournament (series / league / cup) is the umbrella under which matches
 * are organised. Lives at the top of the sports data hierarchy:
 *
 *   Tournament → Match → Player stats
 *                    ↘ Teams (referenced from both sides)
 *
 * Provider IDs are tracked in `externalIds` (one entry per provider so we
 * can support failover / dual-source ingestion). Upserts in
 * `TournamentIngestionService` match on `externalIds.providerKey` +
 * `externalIds.id` so re-running a sync is idempotent.
 */
export interface ITournamentExternalId {
  providerKey: string;
  id: string;
}

export interface ITournament extends BaseDocFields {
  _id: Types.ObjectId;

  sport: Sport;
  name: string;
  /** Short label rendered on cards (e.g. "IPL 2026", "FIFA WC"). */
  shortName: string;
  /** Optional season tag (e.g. "2026", "2025-26"). */
  season: string | null;
  /** ISO country / region code (UN-M49 or `INT` for international). */
  country: string | null;

  status: TournamentStatus;
  startDate: Date | null;
  endDate: Date | null;

  logoUrl: string | null;
  /** Hex / brand color rendered behind tournament badges. */
  accentColor: string | null;

  /** Provider-side identifiers. Unique per `(providerKey, id)` pair. */
  externalIds: ITournamentExternalId[];
  /** Last successful provider sync. Used by health endpoints. */
  lastSyncedAt: Date | null;
}

export type TournamentDoc = HydratedDocument<ITournament>;
export type TournamentModel = Model<ITournament>;

const tournamentSchema = createBaseSchema<ITournament>(
  {
    sport: { type: String, enum: Object.values(Sport), required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    shortName: { type: String, required: true, trim: true, maxlength: 60 },
    season: { type: String, default: null, trim: true, maxlength: 32 },
    country: { type: String, default: null, trim: true, uppercase: true, maxlength: 8 },

    status: {
      type: String,
      enum: Object.values(TournamentStatus),
      default: TournamentStatus.UPCOMING,
      required: true,
      index: true,
    },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },

    logoUrl: { type: String, default: null, maxlength: 1024 },
    accentColor: { type: String, default: null, maxlength: 16 },

    externalIds: {
      type: [
        new Schema<ITournamentExternalId>(
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
  { collection: 'tournaments' },
);

tournamentSchema.index({ sport: 1, status: 1, startDate: 1 });
tournamentSchema.index({ 'externalIds.providerKey': 1, 'externalIds.id': 1 });
tournamentSchema.index({ shortName: 'text', name: 'text' });

export const Tournament: TournamentModel = model<ITournament>('Tournament', tournamentSchema);

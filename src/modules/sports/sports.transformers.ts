import type { Types } from 'mongoose';

import type { ITournament } from './tournament.model';
import type { ITeam } from './team.model';
import type { IPlayer } from './player.model';
import type { IMatch } from './match.model';
import type {
  ProviderMatchDTO,
  ProviderPlayerDTO,
  ProviderTeamDTO,
  ProviderTournamentDTO,
} from './sports-provider.types';

/**
 * Provider-DTO → domain-entity transformers.
 *
 * Single layer of normalisation between the external vocabulary and our
 * canonical models. Keeps the ingestion services free of shape-shifting
 * code and lets us write provider-agnostic unit tests for both sides.
 *
 * Each transformer is PURE — given the same input it always produces the
 * same output. They do NOT touch MongoDB; ingestion services pass the
 * resulting partial entity into upsert calls.
 *
 *  Conventions:
 *   - Always return a `Partial` of the entity so the caller can decide
 *     whether to spread it onto `$set` or `$setOnInsert`.
 *   - Always tag `externalIds` so re-syncing collapses on the natural key.
 *   - NEVER include `_id`, `createdAt`, `updatedAt`, or `isDeleted`.
 */

const externalId = (providerKey: string, id: string): { providerKey: string; id: string } => ({
  providerKey,
  id,
});

const safeDate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const tournamentTransformer = {
  toEntity(providerKey: string, dto: ProviderTournamentDTO): Partial<ITournament> {
    return {
      sport: dto.sport,
      name: dto.name,
      shortName: dto.shortName,
      season: dto.season,
      country: dto.country,
      status: dto.status,
      startDate: safeDate(dto.startDate),
      endDate: safeDate(dto.endDate),
      logoUrl: dto.logoUrl,
      accentColor: dto.accentColor,
      externalIds: [externalId(providerKey, dto.id)],
      lastSyncedAt: new Date(),
    };
  },
};

export const teamTransformer = {
  toEntity(providerKey: string, dto: ProviderTeamDTO): Partial<ITeam> {
    return {
      sport: dto.sport,
      name: dto.name,
      shortName: dto.shortName.toUpperCase(),
      country: dto.country,
      logoUrl: dto.logoUrl,
      primaryColor: dto.primaryColor,
      secondaryColor: dto.secondaryColor,
      externalIds: [externalId(providerKey, dto.id)],
      lastSyncedAt: new Date(),
    };
  },
};

export const playerTransformer = {
  /**
   * Resolves the `teamProviderId` into an internal `teamId` via the
   * caller-supplied lookup map. The map is populated by the ingestion
   * service after teams are upserted.
   */
  toEntity(
    providerKey: string,
    dto: ProviderPlayerDTO,
    teamIdMap: Map<string, Types.ObjectId>,
  ): Partial<IPlayer> {
    return {
      sport: dto.sport,
      name: dto.name,
      shortName: dto.shortName,
      role: dto.role,
      position: dto.position,
      teamId: dto.teamProviderId ? teamIdMap.get(dto.teamProviderId) ?? null : null,
      country: dto.country,
      battingStyle: dto.battingStyle,
      bowlingStyle: dto.bowlingStyle,
      jerseyNumber: dto.jerseyNumber,
      dateOfBirth: safeDate(dto.dateOfBirth),
      photoUrl: dto.photoUrl,
      isActive: dto.isActive,
      externalIds: [externalId(providerKey, dto.id)],
      lastSyncedAt: new Date(),
    };
  },
};

/**
 * Match transformer needs THREE id maps because the provider only knows
 * its own ids. The ingestion service upserts tournaments → teams first,
 * builds the maps, then maps matches in one pass.
 */
export const matchTransformer = {
  toEntity(
    providerKey: string,
    dto: ProviderMatchDTO,
    maps: {
      tournamentIdMap: Map<string, Types.ObjectId>;
      teamIdMap: Map<string, Types.ObjectId>;
    },
  ): Partial<IMatch> | null {
    const tournamentId = maps.tournamentIdMap.get(dto.tournamentProviderId);
    const homeTeamId = maps.teamIdMap.get(dto.homeTeamProviderId);
    const awayTeamId = maps.teamIdMap.get(dto.awayTeamProviderId);

    // Without resolvable refs we can't insert a valid match — let the
    // ingestion service report it as a skipped row.
    if (!tournamentId || !homeTeamId || !awayTeamId) return null;

    const winnerTeamId = dto.winnerTeamProviderId
      ? maps.teamIdMap.get(dto.winnerTeamProviderId) ?? null
      : null;
    const tossWinnerTeamId = dto.tossWinnerTeamProviderId
      ? maps.teamIdMap.get(dto.tossWinnerTeamProviderId) ?? null
      : null;

    const scores = dto.scores
      .map((s) => {
        const teamId = maps.teamIdMap.get(s.teamProviderId);
        if (!teamId) return null;
        return {
          teamId,
          score: s.score,
          secondary: s.secondary,
          overs: s.overs,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    const scheduledAt = safeDate(dto.scheduledAt) ?? new Date();

    return {
      sport: dto.sport,
      format: dto.format,
      tournamentId,
      homeTeamId,
      awayTeamId,
      status: dto.status,
      scheduledAt,
      startedAt: safeDate(dto.startedAt),
      completedAt: safeDate(dto.completedAt),
      venue: dto.venue,
      scores,
      resultSummary: dto.resultSummary,
      winnerTeamId,
      tossWinnerTeamId,
      tossDecision: dto.tossDecision,
      externalIds: [externalId(providerKey, dto.id)],
      lastSyncedAt: new Date(),
    };
  },
};

import type { HydratedDocument } from 'mongoose';

import type { IMatch } from './match.model';
import type { IMatchUpdate } from './match-update.model';
import type { IPlayer } from './player.model';
import type { IPlayerStats } from './player-stats.model';
import type { ITeam } from './team.model';
import type { ITournament } from './tournament.model';
import type {
  SportsMatchCardDTO,
  SportsMatchDetailDTO,
  SportsMatchUpdateDTO,
  SportsPlayerDTO,
  SportsPlayerStatsDTO,
  SportsTeamDTO,
  SportsTournamentDTO,
} from './sports.types';

/**
 * Domain entity → public DTO serializers.
 *
 * Kept separate from `sports.transformers.ts` (provider → entity) so the
 * direction of conversion is obvious from the call site.
 *
 * Every helper is PURE and accepts ALREADY-RESOLVED references (team /
 * tournament docs) — services do the lookups, serializers only project.
 */

const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const tournamentSerializer = {
  toDTO(doc: HydratedDocument<ITournament>): SportsTournamentDTO {
    return {
      id: String(doc._id),
      sport: doc.sport,
      name: doc.name,
      shortName: doc.shortName,
      season: doc.season,
      country: doc.country,
      status: doc.status,
      startDate: toIso(doc.startDate),
      endDate: toIso(doc.endDate),
      logoUrl: doc.logoUrl,
      accentColor: doc.accentColor,
    };
  },
};

export const teamSerializer = {
  toDTO(doc: HydratedDocument<ITeam>): SportsTeamDTO {
    return {
      id: String(doc._id),
      sport: doc.sport,
      name: doc.name,
      shortName: doc.shortName,
      country: doc.country,
      logoUrl: doc.logoUrl,
      primaryColor: doc.primaryColor,
      secondaryColor: doc.secondaryColor,
    };
  },
};

export const playerSerializer = {
  toDTO(doc: HydratedDocument<IPlayer>): SportsPlayerDTO {
    return {
      id: String(doc._id),
      sport: doc.sport,
      name: doc.name,
      shortName: doc.shortName,
      role: doc.role,
      position: doc.position,
      teamId: doc.teamId ? String(doc.teamId) : null,
      country: doc.country,
      battingStyle: doc.battingStyle,
      bowlingStyle: doc.bowlingStyle,
      jerseyNumber: doc.jerseyNumber,
      dateOfBirth: toIso(doc.dateOfBirth),
      photoUrl: doc.photoUrl,
      isActive: doc.isActive,
      baseCredits: doc.baseCredits,
    };
  },
};

export const playerStatsSerializer = {
  toDTO(doc: HydratedDocument<IPlayerStats>): SportsPlayerStatsDTO {
    return {
      id: String(doc._id),
      matchId: String(doc.matchId),
      playerId: String(doc.playerId),
      sport: doc.sport,
      teamId: doc.teamId ? String(doc.teamId) : null,
      isInLineup: doc.isInLineup,
      isPlayed: doc.isPlayed,
      isPlayerOfMatch: doc.isPlayerOfMatch,
      stats: doc.stats,
      fantasyPoints: doc.fantasyPoints,
    };
  },
};

export const matchUpdateSerializer = {
  toDTO(doc: HydratedDocument<IMatchUpdate>): SportsMatchUpdateDTO {
    return {
      id: String(doc._id),
      matchId: String(doc.matchId),
      type: doc.type,
      sequence: doc.sequence,
      providerKey: doc.providerKey,
      payload: doc.payload,
      occurredAt: doc.occurredAt.toISOString(),
    };
  },
};

/**
 * Compact match card. Requires pre-resolved team + tournament docs so
 * the caller can populate the embedded summary fields without an N+1.
 */
export const matchSerializer = {
  toCardDTO(
    doc: HydratedDocument<IMatch>,
    ctx: {
      home: HydratedDocument<ITeam>;
      away: HydratedDocument<ITeam>;
      tournament: HydratedDocument<ITournament>;
    },
  ): SportsMatchCardDTO {
    return {
      id: String(doc._id),
      sport: doc.sport,
      format: doc.format,
      status: doc.status,
      scheduledAt: doc.scheduledAt.toISOString(),
      startedAt: toIso(doc.startedAt),
      completedAt: toIso(doc.completedAt),
      isFeatured: doc.isFeatured,
      isLive: doc.status === 'LIVE',
      tournament: {
        id: String(ctx.tournament._id),
        name: ctx.tournament.name,
        shortName: ctx.tournament.shortName,
        season: ctx.tournament.season,
        logoUrl: ctx.tournament.logoUrl,
        accentColor: ctx.tournament.accentColor,
      },
      homeTeam: {
        id: String(ctx.home._id),
        name: ctx.home.name,
        shortName: ctx.home.shortName,
        logoUrl: ctx.home.logoUrl,
        primaryColor: ctx.home.primaryColor,
      },
      awayTeam: {
        id: String(ctx.away._id),
        name: ctx.away.name,
        shortName: ctx.away.shortName,
        logoUrl: ctx.away.logoUrl,
        primaryColor: ctx.away.primaryColor,
      },
      scores: doc.scores.map((s) => ({
        teamId: String(s.teamId),
        score: s.score,
        secondary: s.secondary,
        overs: s.overs,
      })),
      resultSummary: doc.resultSummary,
      venue: doc.venue,
      lineupLockedAt: toIso(doc.lineupLockedAt),
      lastUpdateAt: toIso(doc.lastUpdateAt),
    };
  },

  toDetailDTO(
    doc: HydratedDocument<IMatch>,
    ctx: {
      home: HydratedDocument<ITeam>;
      away: HydratedDocument<ITeam>;
      tournament: HydratedDocument<ITournament>;
    },
  ): SportsMatchDetailDTO {
    return {
      ...matchSerializer.toCardDTO(doc, ctx),
      winnerTeamId: doc.winnerTeamId ? String(doc.winnerTeamId) : null,
      tossWinnerTeamId: doc.tossWinnerTeamId ? String(doc.tossWinnerTeamId) : null,
      tossDecision: doc.tossDecision,
      popularityScore: doc.popularityScore,
      viewCount: doc.viewCount,
    };
  },
};

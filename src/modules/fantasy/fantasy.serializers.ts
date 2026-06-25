import type { HydratedDocument, Types } from 'mongoose';

import type { IPlayer } from '@modules/sports/player.model';
import type { ITeam } from '@modules/sports/team.model';

import type { IFantasyRule } from './fantasy-rule.model';
import type { IFantasyScoringRule } from './fantasy-scoring-rule.model';
import type { IFantasyTeam, IFantasyTeamPlayer } from './fantasy-team.model';
import type { IFantasyTeamDraft, IFantasyDraftPlayer } from './fantasy-team-draft.model';
import type {
  FantasyDraftDTO,
  FantasyDraftPlayerDTO,
  FantasyMatchPlayerDTO,
  FantasyRuleDTO,
  FantasyScoringRuleDTO,
  FantasyTeamDTO,
  FantasyTeamPlayerDTO,
  FantasyTeamSummaryDTO,
} from './fantasy.types';

/**
 * Domain entity → public DTO serializers for the fantasy module.
 *
 * Serializers are pure and accept already-resolved references (player /
 * team lookups). Services do the IO; serializers only project.
 */

const toIso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

const idStr = (id: Types.ObjectId | string | null | undefined): string =>
  id ? String(id) : '';

/** Returns a small player snapshot for the team-detail UI. */
const playerSnapshot = (
  p: HydratedDocument<IPlayer> | null,
): FantasyTeamPlayerDTO['player'] => {
  if (!p) return null;
  return { id: String(p._id), name: p.name, shortName: p.shortName, photoUrl: p.photoUrl };
};

const teamSnapshot = (t: HydratedDocument<ITeam> | null): FantasyTeamPlayerDTO['team'] => {
  if (!t) return null;
  return {
    id: String(t._id),
    name: t.name,
    shortName: t.shortName,
    logoUrl: t.logoUrl,
    primaryColor: t.primaryColor,
  };
};

// ─── Rule serializers ─────────────────────────────────────────────────

export const fantasyRuleSerializer = {
  toDTO(doc: HydratedDocument<IFantasyRule>): FantasyRuleDTO {
    return {
      id: String(doc._id),
      sport: doc.sport,
      format: doc.format,
      name: doc.name,
      description: doc.description,
      isActive: doc.isActive,
      teamSize: doc.teamSize,
      creditBudget: doc.creditBudget,
      minPerPlayerCredits: doc.minPerPlayerCredits,
      maxPerPlayerCredits: doc.maxPerPlayerCredits,
      minFromSingleTeam: doc.minFromSingleTeam,
      maxFromSingleTeam: doc.maxFromSingleTeam,
      roleConstraints: doc.roleConstraints.map((rc) => ({
        role: rc.role,
        min: rc.min,
        max: rc.max,
      })),
      captainMultiplier: doc.captainMultiplier,
      viceCaptainMultiplier: doc.viceCaptainMultiplier,
      maxTeamsPerUserPerMatch: doc.maxTeamsPerUserPerMatch,
      warnAtTeamsPerUserPerMatch: doc.warnAtTeamsPerUserPerMatch,
      version: doc.version,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  },
};

export const fantasyScoringRuleSerializer = {
  toDTO(doc: HydratedDocument<IFantasyScoringRule>): FantasyScoringRuleDTO {
    return {
      id: String(doc._id),
      sport: doc.sport,
      format: doc.format,
      name: doc.name,
      description: doc.description,
      isActive: doc.isActive,
      version: doc.version,
      events: doc.events.map((e) => ({
        code: e.code,
        category: e.category,
        label: e.label,
        statKey: e.statKey,
        points: e.points,
        threshold: e.threshold,
        unit: e.unit,
        appliesTo: e.appliesTo,
        sortOrder: e.sortOrder,
      })),
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  },
};

// ─── Team serializer ──────────────────────────────────────────────────

export interface PlayerLookupMaps {
  players: Map<string, HydratedDocument<IPlayer>>;
  teams: Map<string, HydratedDocument<ITeam>>;
}

const playerDTO = (
  p: IFantasyTeamPlayer,
  maps: PlayerLookupMaps,
  pointsEarned = 0,
): FantasyTeamPlayerDTO => ({
  playerId: String(p.playerId),
  player: playerSnapshot(maps.players.get(String(p.playerId)) ?? null),
  teamId: String(p.teamId),
  team: teamSnapshot(maps.teams.get(String(p.teamId)) ?? null),
  role: p.role,
  credits: p.credits,
  isCaptain: p.isCaptain,
  isViceCaptain: p.isViceCaptain,
  pointsEarned,
});

export const fantasyTeamSerializer = {
  toDTO(
    doc: HydratedDocument<IFantasyTeam>,
    maps: PlayerLookupMaps,
  ): FantasyTeamDTO {
    return {
      id: String(doc._id),
      userId: String(doc.userId),
      matchId: String(doc.matchId),
      sport: doc.sport,
      format: doc.format,
      ruleId: String(doc.ruleId),
      ruleVersion: doc.ruleVersion,
      name: doc.name,
      accentColor: doc.accentColor,
      status: doc.status,
      lockedAt: toIso(doc.lockedAt),
      players: doc.players.map((p) => playerDTO(p, maps)),
      totalCreditsUsed: doc.totalCreditsUsed,
      captainPlayerId: String(doc.captainPlayerId),
      viceCaptainPlayerId: String(doc.viceCaptainPlayerId),
      roleBreakdown: doc.roleBreakdown ?? {},
      teamBreakdown: doc.teamBreakdown ?? {},
      totalPoints: doc.totalPoints,
      pointsBreakdown: {
        batting: doc.pointsBreakdown.batting,
        bowling: doc.pointsBreakdown.bowling,
        fielding: doc.pointsBreakdown.fielding,
        bonus: doc.pointsBreakdown.bonus,
        penalty: doc.pointsBreakdown.penalty,
      },
      pointsLastComputedAt: toIso(doc.pointsLastComputedAt),
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  },

  toSummaryDTO(doc: HydratedDocument<IFantasyTeam>): FantasyTeamSummaryDTO {
    return {
      id: String(doc._id),
      matchId: String(doc.matchId),
      name: doc.name,
      accentColor: doc.accentColor,
      status: doc.status,
      totalCreditsUsed: doc.totalCreditsUsed,
      totalPoints: doc.totalPoints,
      playersCount: doc.players.length,
      captainPlayerId: String(doc.captainPlayerId),
      viceCaptainPlayerId: String(doc.viceCaptainPlayerId),
      roleBreakdown: doc.roleBreakdown ?? {},
      teamBreakdown: doc.teamBreakdown ?? {},
      updatedAt: doc.updatedAt.toISOString(),
    };
  },
};

// ─── Draft serializer ─────────────────────────────────────────────────

const draftPlayerDTO = (p: IFantasyDraftPlayer): FantasyDraftPlayerDTO => ({
  playerId: String(p.playerId),
  role: p.role,
  teamId: p.teamId ? String(p.teamId) : null,
  credits: p.credits,
  isCaptain: p.isCaptain,
  isViceCaptain: p.isViceCaptain,
});

export const fantasyDraftSerializer = {
  toDTO(doc: HydratedDocument<IFantasyTeamDraft>): FantasyDraftDTO {
    return {
      id: String(doc._id),
      userId: String(doc.userId),
      matchId: String(doc.matchId),
      sport: doc.sport,
      format: doc.format,
      clientDraftId: doc.clientDraftId,
      ruleId: doc.ruleId ? String(doc.ruleId) : null,
      ruleVersion: doc.ruleVersion,
      name: doc.name,
      players: doc.players.map(draftPlayerDTO),
      totalCreditsUsed: doc.totalCreditsUsed,
      captainPlayerId: doc.captainPlayerId ? String(doc.captainPlayerId) : null,
      viceCaptainPlayerId: doc.viceCaptainPlayerId ? String(doc.viceCaptainPlayerId) : null,
      lastEditedAt: doc.lastEditedAt.toISOString(),
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  },
};

// ─── Match-player listing for the create-team UI ──────────────────────

export interface FantasyMatchPlayerInput {
  player: HydratedDocument<IPlayer>;
  team: HydratedDocument<ITeam> | null;
  credits: number;
  selectionPercent: number | null;
  isInLineup: boolean | null;
}

export const fantasyMatchPlayerSerializer = {
  toDTO(input: FantasyMatchPlayerInput): FantasyMatchPlayerDTO {
    const { player, team, credits, selectionPercent, isInLineup } = input;
    return {
      id: String(player._id),
      name: player.name,
      shortName: player.shortName,
      photoUrl: player.photoUrl,
      role: player.role,
      country: player.country,
      team: teamSnapshot(team),
      credits,
      selectionPercent,
      isInLineup,
    };
  },
};

export { idStr };

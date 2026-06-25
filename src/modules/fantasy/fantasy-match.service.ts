import { type HydratedDocument } from 'mongoose';

import { NotFoundError } from '@common/errors/AppError';

import { Match, type IMatch } from '@modules/sports/match.model';
import { Player, type IPlayer } from '@modules/sports/player.model';
import { playerStatsRepository } from '@modules/sports/player-stats.repository';
import { Team, type ITeam } from '@modules/sports/team.model';
import { Tournament } from '@modules/sports/tournament.model';

import { fantasyRuleService } from './fantasy-rule.service';
import { fantasyScoringRuleService } from './fantasy-scoring-rule.service';
import { fantasyTeamPlayerRepository } from './fantasy-team-player.repository';
import {
  fantasyMatchPlayerSerializer,
  fantasyRuleSerializer,
  fantasyScoringRuleSerializer,
} from './fantasy.serializers';
import type { FantasyMatchContextDTO } from './fantasy.types';

/**
 * Service that assembles the *fantasy match context* — the bundle of
 * data the create-team UI needs in a single round-trip:
 *  - active fantasy rule,
 *  - active scoring rule,
 *  - eligible players + per-player credits + selection percentages.
 *
 * Implemented as a thin orchestrator on top of the sports module's
 * existing repositories — the fantasy module never mutates sports data.
 */
class FantasyMatchService {
  async getContext(matchId: string): Promise<FantasyMatchContextDTO> {
    const match = await this.requireMatch(matchId);

    const [rule, scoringRule] = await Promise.all([
      fantasyRuleService.getActive(match.sport, match.format),
      fantasyScoringRuleService.getActive(match.sport, match.format),
    ]);

    const teamIds = [match.homeTeamId, match.awayTeamId];
    const teams = await Team.find({ _id: { $in: teamIds } }).exec();
    const teamMap = new Map<string, HydratedDocument<ITeam>>();
    for (const t of teams) teamMap.set(String(t._id), t);

    const players = await Player.find({
      teamId: { $in: teamIds },
      isActive: true,
    })
      .sort({ baseCredits: -1, name: 1 })
      .exec();

    const lineup = await playerStatsRepository.listForMatch(matchId);
    const lineupMap = new Map<string, boolean>();
    for (const stat of lineup) {
      lineupMap.set(String(stat.playerId), stat.isInLineup);
    }

    // Selection percent — count of teams that picked this player.
    // Computed in a single aggregate to avoid N+1.
    const totalTeams = await fantasyTeamPlayerRepository.count({ matchId });
    let pickCountByPlayer = new Map<string, number>();
    if (totalTeams > 0) {
      const rows = await fantasyTeamPlayerRepository
        .aggregate<{ _id: { playerId: string }; count: number }>([
          { $match: { matchId: match._id, isDeleted: false } },
          { $group: { _id: { playerId: '$playerId' }, count: { $sum: 1 } } },
        ]);
      pickCountByPlayer = new Map(rows.map((r) => [String(r._id.playerId), r.count]));
    }

    const playerDtos = players.flatMap((player: HydratedDocument<IPlayer>) => {
      const team = player.teamId ? teamMap.get(String(player.teamId)) : null;
      if (!team) return [];
      const picks = pickCountByPlayer.get(String(player._id)) ?? 0;
      const selectionPercent = totalTeams > 0 ? Number(((picks / totalTeams) * 100).toFixed(1)) : null;
      const isInLineup = lineupMap.has(String(player._id))
        ? Boolean(lineupMap.get(String(player._id)))
        : null;

      return [
        fantasyMatchPlayerSerializer.toDTO({
          player,
          team,
          credits: player.baseCredits,
          selectionPercent,
          isInLineup,
        }),
      ];
    });

    const homeTeam = teamMap.get(String(match.homeTeamId));
    const awayTeam = teamMap.get(String(match.awayTeamId));
    const tournament = match.tournamentId
      ? await Tournament.findById(match.tournamentId).exec()
      : null;

    return {
      matchId: String(match._id),
      sport: match.sport,
      format: match.format,
      lineupLockedAt: match.lineupLockedAt ? match.lineupLockedAt.toISOString() : null,
      isLocked:
        match.status !== 'UPCOMING' ||
        (match.lineupLockedAt ? match.lineupLockedAt.getTime() <= Date.now() : false),
      match: homeTeam && awayTeam
        ? {
            id: String(match._id),
            status: match.status,
            scheduledAt: match.scheduledAt.toISOString(),
            startedAt: match.startedAt ? match.startedAt.toISOString() : null,
            completedAt: match.completedAt ? match.completedAt.toISOString() : null,
            resultSummary: match.resultSummary,
            venue: match.venue
              ? {
                  name: match.venue.name ?? null,
                  city: match.venue.city ?? null,
                  country: match.venue.country ?? null,
                }
              : null,
            tournament: tournament
              ? {
                  id: String(tournament._id),
                  name: tournament.name,
                  shortName: tournament.shortName,
                }
              : null,
            homeTeam: {
              id: String(homeTeam._id),
              name: homeTeam.name,
              shortName: homeTeam.shortName,
              logoUrl: homeTeam.logoUrl ?? null,
              primaryColor: homeTeam.primaryColor ?? null,
            },
            awayTeam: {
              id: String(awayTeam._id),
              name: awayTeam.name,
              shortName: awayTeam.shortName,
              logoUrl: awayTeam.logoUrl ?? null,
              primaryColor: awayTeam.primaryColor ?? null,
            },
            scores: (match.scores ?? []).map((s) => ({
              teamId: String(s.teamId),
              score: s.score ?? 0,
              secondary: s.secondary ?? null,
              overs: s.overs ?? null,
            })),
          }
        : null,
      rule: rule ? fantasyRuleSerializer.toDTO(rule) : null,
      scoringRule: scoringRule ? fantasyScoringRuleSerializer.toDTO(scoringRule) : null,
      players: playerDtos,
    };
  }

  private async requireMatch(matchId: string): Promise<HydratedDocument<IMatch>> {
    const match = await Match.findById(matchId).exec();
    if (!match) throw new NotFoundError('Match');
    return match;
  }
}

export const fantasyMatchService = new FantasyMatchService();

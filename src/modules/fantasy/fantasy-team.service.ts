import { type ClientSession, type HydratedDocument, Types } from 'mongoose';

import { logger } from '@config/logger.config';

import { ErrorCode, HttpStatus } from '@common/constants';
import {
  AuditAction,
  FantasyTeamStatus,
  FantasyValidationIssueCode,
  MatchStatus,
} from '@common/enums';
import { AppError, NotFoundError } from '@common/errors/AppError';
import { auditLogger } from '@common/logging';
import { withTransaction } from '@common/utils/transaction.util';

import { Match, type IMatch } from '@modules/sports/match.model';
import { Player, type IPlayer } from '@modules/sports/player.model';
import { Team, type ITeam } from '@modules/sports/team.model';

import { fantasyRuleService } from './fantasy-rule.service';
import { FantasyTeam, type FantasyTeamDoc, type IFantasyTeamPlayer } from './fantasy-team.model';
import { fantasyTeamRepository } from './fantasy-team.repository';
import { fantasyTeamPlayerRepository } from './fantasy-team-player.repository';
import { fantasyCache } from './fantasy-cache';
import type { PaginationParams } from '@common/types/common.types';

import type {
  FantasyTeamCloneBody,
  FantasyTeamCreateBody,
  FantasyTeamPreviewBody,
  FantasyTeamUpdateBody,
} from './fantasy.validators';
import {
  validateFantasyTeam,
  type FantasyValidationResult,
  type FantasyValidatorPlayer,
} from './fantasy.validator';

interface UserCtx {
  userId: string;
}

interface PlayerSnapshot {
  player: HydratedDocument<IPlayer>;
  team: HydratedDocument<ITeam>;
}

interface ValidatedRoster {
  validatorPlayers: FantasyValidatorPlayer[];
  domainPlayers: IFantasyTeamPlayer[];
  totalCredits: number;
  captainId: Types.ObjectId;
  viceCaptainId: Types.ObjectId;
  roleBreakdown: Record<string, number>;
  teamBreakdown: Record<string, number>;
  playerSnapshots: Map<string, PlayerSnapshot>;
}

/**
 * Service that owns the fantasy team lifecycle: create / read / update /
 * clone / soft-delete + preview validation.
 *
 * Responsibilities split:
 *  - **Pure rules** live in `fantasy.validator.ts` (sport-agnostic, IO-
 *    free). This service composes the validator with IO it needs (match
 *    lookup, player snapshots, existing-team count).
 *  - **Transaction discipline**: every write that touches BOTH the
 *    canonical `fantasy_teams` doc AND the `fantasy_team_players`
 *    projection runs inside a single MongoDB transaction. If the
 *    projection write fails, the canonical write also rolls back so the
 *    two collections never diverge.
 *  - **Audit**: every successful mutation emits an audit log; validation
 *    failures emit a FAILURE audit entry so admins can spot abuse.
 */
class FantasyTeamService {
  // ─── Reads ──────────────────────────────────────────────────────────

  list(
    ctx: UserCtx,
    options: PaginationParams & { matchId?: string },
  ) {
    const { matchId, ...pagination } = options;
    return fantasyTeamRepository.list({ userId: ctx.userId, matchId }, pagination);
  }

  async getById(ctx: UserCtx, id: string): Promise<FantasyTeamDoc> {
    const team = await fantasyTeamRepository.findByIdScoped(id, ctx.userId);
    if (!team) throw new NotFoundError('Fantasy team');
    return team;
  }

  async listForMatch(ctx: UserCtx, matchId: string): Promise<FantasyTeamDoc[]> {
    return fantasyTeamRepository.findByUserAndMatch(ctx.userId, matchId);
  }

  // ─── Preview validation ─────────────────────────────────────────────

  /**
   * Stateless validation used by the create-team UI to render live
   * feedback as the user picks players. Does not persist anything.
   */
  async preview(ctx: UserCtx, body: FantasyTeamPreviewBody): Promise<FantasyValidationResult> {
    const match = await this.requireMatch(body.matchId);
    const rule = await fantasyRuleService.requireActive(match.sport, match.format);
    const snapshots = await this.snapshotPlayers(body.players.map((p) => p.playerId));
    const validatorPlayers = body.players.map((p) =>
      this.buildValidatorPlayer(p.playerId, p.isCaptain, p.isViceCaptain, snapshots),
    );
    const existingTeamCount = await fantasyTeamRepository.countByUserAndMatch(
      ctx.userId,
      body.matchId,
    );
    return validateFantasyTeam({
      rule,
      players: validatorPlayers,
      matchLocked: this.isMatchLocked(match),
      existingTeamCount,
    });
  }

  // ─── Writes ─────────────────────────────────────────────────────────

  async create(
    ctx: UserCtx,
    body: FantasyTeamCreateBody,
    actorRoles?: string[],
  ): Promise<FantasyTeamDoc> {
    const match = await this.requireMatch(body.matchId);
    const rule = await fantasyRuleService.requireActive(match.sport, match.format);
    if (this.isMatchLocked(match)) {
      throw this.lockedError();
    }

    const existingTeamCount = await fantasyTeamRepository.countByUserAndMatch(
      ctx.userId,
      body.matchId,
    );
    const roster = await this.assembleRoster(body.players);
    const validation = validateFantasyTeam({
      rule,
      players: roster.validatorPlayers,
      matchLocked: false,
      existingTeamCount,
    });
    if (!validation.isValid) {
      await this.auditFailure(ctx, body.matchId, validation, actorRoles);
      throw this.validationError(validation);
    }

    const name = body.name?.trim() || `Team ${existingTeamCount + 1}`;

    const created = await withTransaction(async (session) => {
      const [doc] = await FantasyTeam.create(
        [
          {
            userId: new Types.ObjectId(ctx.userId),
            matchId: match._id,
            sport: match.sport,
            format: match.format,
            ruleId: rule._id,
            ruleVersion: rule.version,
            name,
            accentColor: body.accentColor ?? null,
            status: FantasyTeamStatus.EDITABLE,
            players: roster.domainPlayers,
            totalCreditsUsed: roster.totalCredits,
            captainPlayerId: roster.captainId,
            viceCaptainPlayerId: roster.viceCaptainId,
            roleBreakdown: roster.roleBreakdown,
            teamBreakdown: roster.teamBreakdown,
          },
        ],
        { session },
      );
      await this.persistProjection(doc, session);
      return doc;
    });

    await this.invalidateUserMatchCache(ctx.userId, body.matchId);
    await this.audit(AuditAction.FANTASY_TEAM_CREATED, created, ctx, actorRoles);
    return created;
  }

  async update(
    ctx: UserCtx,
    teamId: string,
    body: FantasyTeamUpdateBody,
    actorRoles?: string[],
  ): Promise<FantasyTeamDoc> {
    const existing = await this.getById(ctx, teamId);
    if (existing.status !== FantasyTeamStatus.EDITABLE) {
      throw this.lockedError();
    }

    const match = await this.requireMatch(String(existing.matchId));
    if (this.isMatchLocked(match)) throw this.lockedError();

    const rule = await fantasyRuleService.requireActive(existing.sport, existing.format);

    let roster: ValidatedRoster | null = null;
    if (body.players) {
      roster = await this.assembleRoster(body.players);
      const validation = validateFantasyTeam({
        rule,
        players: roster.validatorPlayers,
        matchLocked: false,
        existingTeamCount: 0,
        isEdit: true,
      });
      if (!validation.isValid) {
        await this.auditFailure(ctx, String(existing.matchId), validation, actorRoles);
        throw this.validationError(validation);
      }
    }

    const updated = await withTransaction(async (session) => {
      const patch: Partial<FantasyTeamDoc> = {};
      if (body.name !== undefined) patch.name = body.name.trim();
      if (body.accentColor !== undefined) patch.accentColor = body.accentColor;
      if (roster) {
        patch.players = roster.domainPlayers;
        patch.totalCreditsUsed = roster.totalCredits;
        patch.captainPlayerId = roster.captainId;
        patch.viceCaptainPlayerId = roster.viceCaptainId;
        patch.roleBreakdown = roster.roleBreakdown;
        patch.teamBreakdown = roster.teamBreakdown;
      }
      const doc = await FantasyTeam.findOneAndUpdate(
        { _id: teamId, userId: ctx.userId },
        { $set: patch },
        { new: true, session },
      ).exec();
      if (!doc) throw new NotFoundError('Fantasy team');
      if (roster) {
        await fantasyTeamPlayerRepository.replaceRoster(
          doc._id,
          this.buildProjectionRows(doc),
          session,
        );
      }
      return doc;
    });

    await this.invalidateUserMatchCache(ctx.userId, String(existing.matchId));
    await this.audit(AuditAction.FANTASY_TEAM_UPDATED, updated, ctx, actorRoles);
    return updated;
  }

  async clone(
    ctx: UserCtx,
    teamId: string,
    body: FantasyTeamCloneBody,
    actorRoles?: string[],
  ): Promise<FantasyTeamDoc> {
    const existing = await this.getById(ctx, teamId);
    const match = await this.requireMatch(String(existing.matchId));
    if (this.isMatchLocked(match)) throw this.lockedError();

    const rule = await fantasyRuleService.requireActive(existing.sport, existing.format);
    const existingTeamCount = await fantasyTeamRepository.countByUserAndMatch(
      ctx.userId,
      String(existing.matchId),
    );
    if (existingTeamCount >= rule.maxTeamsPerUserPerMatch) {
      throw new AppError(
        `You already have ${rule.maxTeamsPerUserPerMatch} teams for this match`,
        HttpStatus.CONFLICT,
        ErrorCode.FANTASY_TEAM_LIMIT_REACHED,
      );
    }

    const name = body.name?.trim() || `${existing.name} (copy)`;

    const created = await withTransaction(async (session) => {
      const [doc] = await FantasyTeam.create(
        [
          {
            userId: existing.userId,
            matchId: existing.matchId,
            sport: existing.sport,
            format: existing.format,
            ruleId: rule._id,
            ruleVersion: rule.version,
            name,
            accentColor: existing.accentColor,
            status: FantasyTeamStatus.EDITABLE,
            players: existing.players.map((p) => ({ ...p })),
            totalCreditsUsed: existing.totalCreditsUsed,
            captainPlayerId: existing.captainPlayerId,
            viceCaptainPlayerId: existing.viceCaptainPlayerId,
            roleBreakdown: existing.roleBreakdown,
            teamBreakdown: existing.teamBreakdown,
          },
        ],
        { session },
      );
      await this.persistProjection(doc, session);
      return doc;
    });

    await this.invalidateUserMatchCache(ctx.userId, String(existing.matchId));
    await this.audit(AuditAction.FANTASY_TEAM_CLONED, created, ctx, actorRoles);
    return created;
  }

  async delete(ctx: UserCtx, teamId: string, actorRoles?: string[]): Promise<void> {
    const existing = await this.getById(ctx, teamId);
    if (existing.status !== FantasyTeamStatus.EDITABLE) {
      throw this.lockedError();
    }

    await withTransaction(async (session) => {
      await fantasyTeamRepository.softDelete(teamId, ctx.userId, session);
      await fantasyTeamPlayerRepository.softDeleteByTeamId(teamId, session);
    });

    await this.invalidateUserMatchCache(ctx.userId, String(existing.matchId));
    await this.audit(AuditAction.FANTASY_TEAM_DELETED, existing, ctx, actorRoles);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async requireMatch(matchId: string): Promise<HydratedDocument<IMatch>> {
    const match = await Match.findById(matchId).exec();
    if (!match) throw new NotFoundError('Match');
    return match;
  }

  private isMatchLocked(match: HydratedDocument<IMatch>): boolean {
    if (match.status === MatchStatus.LIVE || match.status === MatchStatus.COMPLETED) {
      return true;
    }
    if (match.lineupLockedAt && match.lineupLockedAt.getTime() <= Date.now()) {
      return true;
    }
    return false;
  }

  private lockedError(): AppError {
    return new AppError(
      'Match has locked — teams can no longer be edited',
      HttpStatus.CONFLICT,
      ErrorCode.FANTASY_TEAM_LOCKED,
    );
  }

  private validationError(result: FantasyValidationResult): AppError {
    // Locked-match issues map to a dedicated 409 so clients can branch
    // cleanly on the error code instead of inspecting issue arrays.
    if (result.issues.some((i) => i.code === FantasyValidationIssueCode.MATCH_LOCKED)) {
      return this.lockedError();
    }
    return new AppError(
      'Fantasy team failed validation',
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.FANTASY_TEAM_INVALID,
      { details: { validation: result } },
    );
  }

  private async snapshotPlayers(playerIds: string[]): Promise<Map<string, PlayerSnapshot>> {
    if (playerIds.length === 0) return new Map();
    const uniqueIds = Array.from(new Set(playerIds));
    const players = await Player.find({ _id: { $in: uniqueIds } }).exec();
    const teamIds = Array.from(
      new Set(players.map((p) => (p.teamId ? String(p.teamId) : null)).filter(Boolean) as string[]),
    );
    const teams = teamIds.length
      ? await Team.find({ _id: { $in: teamIds } }).exec()
      : [];
    const teamMap = new Map<string, HydratedDocument<ITeam>>();
    for (const t of teams) teamMap.set(String(t._id), t);

    const map = new Map<string, PlayerSnapshot>();
    for (const player of players) {
      const teamId = player.teamId ? String(player.teamId) : null;
      const team = teamId ? teamMap.get(teamId) : null;
      if (!team) {
        // A player without a real-world team is unusable for fantasy
        // play. We surface as a validation issue (caller composes).
        continue;
      }
      map.set(String(player._id), { player, team });
    }
    return map;
  }

  private buildValidatorPlayer(
    playerId: string,
    isCaptain: boolean,
    isViceCaptain: boolean,
    snapshots: Map<string, PlayerSnapshot>,
  ): FantasyValidatorPlayer {
    const snap = snapshots.get(playerId);
    if (!snap) {
      // Synthesize a placeholder so the validator can report the issue.
      return {
        playerId,
        role: 'UNKNOWN' as FantasyValidatorPlayer['role'],
        teamId: '',
        credits: 0,
        isCaptain,
        isViceCaptain,
      };
    }
    return {
      playerId,
      role: snap.player.role,
      teamId: String(snap.team._id),
      credits: snap.player.baseCredits,
      isCaptain,
      isViceCaptain,
    };
  }

  private async assembleRoster(
    input: FantasyTeamCreateBody['players'],
  ): Promise<ValidatedRoster> {
    const snapshots = await this.snapshotPlayers(input.map((p) => p.playerId));

    const validatorPlayers: FantasyValidatorPlayer[] = [];
    const domainPlayers: IFantasyTeamPlayer[] = [];
    const roleBreakdown: Record<string, number> = {};
    const teamBreakdown: Record<string, number> = {};
    let totalCredits = 0;
    let captainId: Types.ObjectId | null = null;
    let viceCaptainId: Types.ObjectId | null = null;
    const missing: string[] = [];

    for (const entry of input) {
      const snap = snapshots.get(entry.playerId);
      if (!snap) {
        missing.push(entry.playerId);
        validatorPlayers.push(
          this.buildValidatorPlayer(entry.playerId, entry.isCaptain, entry.isViceCaptain, snapshots),
        );
        continue;
      }

      validatorPlayers.push({
        playerId: entry.playerId,
        role: snap.player.role,
        teamId: String(snap.team._id),
        credits: snap.player.baseCredits,
        isCaptain: entry.isCaptain,
        isViceCaptain: entry.isViceCaptain,
      });

      domainPlayers.push({
        playerId: snap.player._id,
        role: snap.player.role,
        teamId: snap.team._id,
        credits: snap.player.baseCredits,
        isCaptain: entry.isCaptain,
        isViceCaptain: entry.isViceCaptain,
      });

      totalCredits += snap.player.baseCredits;
      roleBreakdown[snap.player.role] = (roleBreakdown[snap.player.role] ?? 0) + 1;
      teamBreakdown[String(snap.team._id)] = (teamBreakdown[String(snap.team._id)] ?? 0) + 1;

      if (entry.isCaptain) captainId = snap.player._id;
      if (entry.isViceCaptain) viceCaptainId = snap.player._id;
    }

    if (missing.length > 0) {
      throw new AppError(
        `One or more selected players were not found`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.PLAYER_NOT_FOUND,
        { details: { missingPlayerIds: missing } },
      );
    }
    if (!captainId || !viceCaptainId) {
      // The Zod schema already guarantees exactly one captain + one
      // vice-captain when `players` is non-empty, but we double-check
      // here so the domain types stay non-null.
      throw new AppError(
        'Captain and vice-captain are required',
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.FANTASY_TEAM_INVALID,
      );
    }

    return {
      validatorPlayers,
      domainPlayers,
      totalCredits: Number(totalCredits.toFixed(2)),
      captainId,
      viceCaptainId,
      roleBreakdown,
      teamBreakdown,
      playerSnapshots: snapshots,
    };
  }

  private buildProjectionRows(team: FantasyTeamDoc) {
    return team.players.map((p) => ({
      fantasyTeamId: team._id,
      userId: team.userId,
      matchId: team.matchId,
      sport: team.sport,
      playerId: p.playerId,
      teamId: p.teamId,
      role: p.role,
      credits: p.credits,
      isCaptain: p.isCaptain,
      isViceCaptain: p.isViceCaptain,
      pointsEarned: 0,
      pointsLastComputedAt: null,
    }));
  }

  private async persistProjection(team: FantasyTeamDoc, session: ClientSession): Promise<void> {
    await fantasyTeamPlayerRepository.insertRoster(
      team.players.map((p) => ({
        fantasyTeamId: team._id,
        userId: team.userId,
        matchId: team.matchId,
        sport: team.sport,
        playerId: p.playerId,
        teamId: p.teamId,
        role: p.role,
        credits: p.credits,
        isCaptain: p.isCaptain,
        isViceCaptain: p.isViceCaptain,
        pointsEarned: 0,
        pointsLastComputedAt: null,
      })),
      session,
    );
  }

  private async invalidateUserMatchCache(userId: string, matchId: string): Promise<void> {
    await fantasyCache.flushScope('user');
    // selection percentages change with every new team — flush the
    // match-scoped selection cache too.
    await fantasyCache.flushScope('selections');
    await fantasyCache.flushScope('match');
    // explicit log keeps the cache invalidation visible in observability
    logger.debug({ userId, matchId }, 'fantasy.cache.invalidate.user-match');
  }

  private async audit(
    action: AuditAction,
    team: FantasyTeamDoc,
    ctx: UserCtx,
    actorRoles?: string[],
  ): Promise<void> {
    try {
      await auditLogger.record({
        action,
        outcome: auditLogger.Outcome.SUCCESS,
        actorId: ctx.userId,
        actorRoles,
        resource: 'fantasy.team',
        resourceId: String(team._id),
        metadata: {
          matchId: String(team.matchId),
          sport: team.sport,
          totalCreditsUsed: team.totalCreditsUsed,
          playersCount: team.players.length,
          captainPlayerId: String(team.captainPlayerId),
          viceCaptainPlayerId: String(team.viceCaptainPlayerId),
        },
      });
    } catch (err) {
      logger.warn({ err, action }, 'fantasy.team.audit.failed');
    }
  }

  private async auditFailure(
    ctx: UserCtx,
    matchId: string,
    result: FantasyValidationResult,
    actorRoles?: string[],
  ): Promise<void> {
    try {
      await auditLogger.record({
        action: AuditAction.FANTASY_TEAM_VALIDATION_FAILED,
        outcome: auditLogger.Outcome.FAILURE,
        actorId: ctx.userId,
        actorRoles,
        resource: 'fantasy.team',
        metadata: {
          matchId,
          issueCount: result.issues.length,
          issueCodes: Array.from(new Set(result.issues.map((i) => i.code))),
          playersSelected: result.summary.playersSelected,
        },
        errorCode: ErrorCode.FANTASY_TEAM_INVALID,
        errorMessage: 'Fantasy team validation failed',
      });
    } catch (err) {
      logger.warn({ err }, 'fantasy.team.audit-failure.failed');
    }
  }
}

export const fantasyTeamService = new FantasyTeamService();

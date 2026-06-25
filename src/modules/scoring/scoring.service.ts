import { Types, type ClientSession } from 'mongoose';

import { logger } from '@config/logger.config';

import { AppConstants, ErrorCode, HttpStatus } from '@common/constants';
import {
  AuditAction,
  AuditOutcome,
  FantasyTeamStatus,
  PlayerRole,
  ScoreEventStatus,
  ScoreEventType,
  type FantasyScoringCategory,
} from '@common/enums';
import { AppError, NotFoundError } from '@common/errors/AppError';
import { auditLogger } from '@common/logging';
import { withTransaction } from '@common/utils/transaction.util';

import { fantasyRuleService } from '@modules/fantasy/fantasy-rule.service';
import { fantasyScoringRuleService } from '@modules/fantasy/fantasy-scoring-rule.service';
import { FantasyTeam, type IFantasyTeam } from '@modules/fantasy/fantasy-team.model';
import { FantasyTeamPlayer } from '@modules/fantasy/fantasy-team-player.model';
import {
  computeTeamPoints,
  type FantasyTeamScoringInput,
} from '@modules/fantasy/fantasy.scoring';
import { Match, type IMatch } from '@modules/sports/match.model';
import { PlayerStats } from '@modules/sports/player-stats.model';

import type {
  IFantasyPointBreakdown,
  IFantasyPointEvent,
} from './fantasy-points.model';
import { fantasyPointsRepository } from './fantasy-points.repository';
import { scoreEventRepository } from './score-event.repository';
import type {
  ManualPointsAdjustmentInput,
  RecomputeMatchResult,
} from './scoring.types';
import type { HydratedDocument } from 'mongoose';

/**
 * Scoring orchestrator.
 *
 * Workflow per match:
 *   1. Load the active scoring rule + team rule (sport+format).
 *   2. Load every `player_stats` row for the match (raw statline).
 *   3. Load every `fantasy_teams` row for the match (the roster).
 *   4. For each team → call the *pure* `computeTeamPoints`.
 *   5. Bulk-update:
 *        - `FantasyTeam.totalPoints` + `pointsBreakdown` + `pointsLastComputedAt`
 *        - `FantasyTeamPlayer.pointsEarned` per row
 *        - `FantasyPoints` (one upsert per playerId)
 *        - `PlayerStats.fantasyPoints` (mirror — capped at 0 because
 *          schema has `min: 0`; rich breakdown lives in `FantasyPoints`).
 *   6. Audit + emit `score_events` row.
 *   7. Enqueue leaderboard refresh (decoupled — leaderboard worker
 *      handles it).
 *
 * Concurrency:
 *   - The whole match recompute runs inside one Mongo transaction so a
 *     mid-flight failure rolls everything back; partial point states
 *     never leak to the leaderboard.
 *   - Live ticks are debounced upstream (see `live-score-sync` worker)
 *     so we never recompute the same match more than once per
 *     `SCORING.LIVE_TICK_DEBOUNCE_MS`.
 */
class ScoringService {
  /** Returns whether the engine can score `matchId` right now. */
  async canScoreMatch(
    matchId: string | Types.ObjectId,
  ): Promise<{ ok: boolean; reason?: string }> {
    const match = await this.requireMatch(matchId);
    const scoringRule = await fantasyScoringRuleService.getActive(match.sport, match.format);
    if (!scoringRule) {
      return { ok: false, reason: 'SCORING_RULE_INACTIVE' };
    }
    const teamRule = await fantasyRuleService.getActive(match.sport, match.format);
    if (!teamRule) {
      return { ok: false, reason: 'FANTASY_RULES_NOT_CONFIGURED' };
    }
    return { ok: true };
  }

  /**
   * Recompute fantasy points for every team in a match. Returns the
   * `score_events` row so callers can chain leaderboard updates with
   * the same audit trail.
   */
  async recomputeForMatch(input: {
    matchId: string | Types.ObjectId;
    type?: ScoreEventType;
    triggeredBy?: string | null;
    context?: Record<string, unknown>;
  }): Promise<RecomputeMatchResult> {
    const start = Date.now();
    const match = await this.requireMatch(input.matchId);
    const scoringRule = await fantasyScoringRuleService.requireActive(match.sport, match.format);
    const teamRule = await fantasyRuleService.requireActive(match.sport, match.format);

    const eventDoc = await scoreEventRepository.startEvent({
      matchId: match._id,
      type: input.type ?? ScoreEventType.LIVE_TICK,
      scoringRuleId: scoringRule._id,
      scoringRuleVersion: scoringRule.version,
      triggeredBy: input.triggeredBy ?? null,
      context: input.context ?? {},
    });

    try {
      // 1️⃣ Pull raw player statlines for the match.
      const statRows = await PlayerStats.find({ matchId: match._id }).exec();
      const statByPlayer = new Map<string, Record<string, number>>();
      const isPlayedByPlayer = new Map<string, boolean>();
      const isPomByPlayer = new Map<string, boolean>();
      for (const row of statRows) {
        const numericStats: Record<string, number> = {};
        for (const [k, v] of Object.entries(row.stats ?? {})) {
          numericStats[k] = typeof v === 'number' ? v : Number(v ?? 0);
        }
        statByPlayer.set(String(row.playerId), numericStats);
        isPlayedByPlayer.set(String(row.playerId), Boolean(row.isPlayed));
        isPomByPlayer.set(String(row.playerId), Boolean(row.isPlayerOfMatch));
      }

      // 2️⃣ Run the engine team-by-team and stage write payloads.
      const teamCursor = FantasyTeam.find({
        matchId: match._id,
        status: { $in: [FantasyTeamStatus.EDITABLE, FantasyTeamStatus.LOCKED, FantasyTeamStatus.SCORED] },
      })
        .lean<HydratedDocument<IFantasyTeam>[]>()
        .cursor({ batchSize: AppConstants.SCORING.BATCH_SIZE });

      type TeamUpdate = {
        teamId: Types.ObjectId;
        totalPoints: number;
        breakdown: IFantasyPointBreakdown;
        perPlayer: Array<{
          playerId: Types.ObjectId;
          isCaptain: boolean;
          isViceCaptain: boolean;
          pointsEarned: number;
        }>;
      };

      const teamUpdates: TeamUpdate[] = [];
      const playerRoleByMatch = new Map<string, PlayerRole>();
      const playerTeamByMatch = new Map<string, Types.ObjectId | null>();
      let teamsProcessed = 0;

      for await (const team of teamCursor) {
        teamsProcessed += 1;
        const engineInput: FantasyTeamScoringInput = {
          scoringRule,
          teamRule,
          players: team.players.map((p) => {
            playerRoleByMatch.set(String(p.playerId), p.role);
            playerTeamByMatch.set(String(p.playerId), p.teamId ?? null);
            return {
              playerId: String(p.playerId),
              role: p.role,
              isCaptain: p.isCaptain,
              isViceCaptain: p.isViceCaptain,
              stats: statByPlayer.get(String(p.playerId)) ?? {},
            };
          }),
        };

        const result = computeTeamPoints(engineInput);
        teamUpdates.push({
          teamId: team._id,
          totalPoints: result.total,
          breakdown: { ...result.breakdown },
          perPlayer: team.players.map((p, i) => ({
            playerId: p.playerId as Types.ObjectId,
            isCaptain: p.isCaptain,
            isViceCaptain: p.isViceCaptain,
            // engine output is in same order as input → safe index lookup
            pointsEarned: result.perPlayer[i]?.output.total ?? 0,
          })),
        });
      }

      // 3️⃣ Per-player base points (no multiplier) — drives `FantasyPoints`.
      const playerPointsPayload = this.buildPlayerPointsPayload(
        match._id,
        statByPlayer,
        playerRoleByMatch,
        playerTeamByMatch,
        isPlayedByPlayer,
        isPomByPlayer,
        scoringRule,
        teamRule,
      );

      // 4️⃣ Persist everything atomically.
      const persistResult = await withTransaction(async (session) =>
        this.persistRecompute(
          {
            matchId: match._id,
            scoringRuleId: scoringRule._id,
            scoringRuleVersion: scoringRule.version,
            teamUpdates,
            playerPointsPayload,
            statByPlayer,
          },
          session,
        ),
      );

      // 5️⃣ Audit + score event finalise.
      const durationMs = Date.now() - start;
      await scoreEventRepository.markCompleted(eventDoc._id, {
        inputRowsCount: statRows.length,
        teamsUpdatedCount: persistResult.teamsUpdated,
        playersUpdatedCount: persistResult.playersUpdated,
        durationMs,
      });

      logger.info(
        {
          matchId: String(match._id),
          scoringRuleVersion: scoringRule.version,
          teamsProcessed,
          teamsUpdated: persistResult.teamsUpdated,
          playersUpdated: persistResult.playersUpdated,
          durationMs,
        },
        '[Scoring] recomputeForMatch completed',
      );

      await auditLogger.record({
        action: AuditAction.SCORING_RECOMPUTED,
        outcome: AuditOutcome.SUCCESS,
        actorId: input.triggeredBy ?? null,
        resource: 'match',
        resourceId: String(match._id),
        metadata: {
          scoringRuleVersion: scoringRule.version,
          teamsUpdated: persistResult.teamsUpdated,
          playersUpdated: persistResult.playersUpdated,
          durationMs,
          type: input.type ?? ScoreEventType.LIVE_TICK,
        },
      });

      return {
        matchId: String(match._id),
        scoreEventId: String(eventDoc._id),
        inputRowsCount: statRows.length,
        teamsUpdatedCount: persistResult.teamsUpdated,
        playersUpdatedCount: persistResult.playersUpdated,
        durationMs,
        scoringRuleVersion: scoringRule.version,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      await scoreEventRepository.markFailed(eventDoc._id, {
        durationMs,
        errorMessage: message,
        errorCode: ErrorCode.SCORING_RECOMPUTE_FAILED,
      });
      logger.error(
        { err, matchId: String(input.matchId), durationMs },
        '[Scoring] recomputeForMatch failed',
      );
      await auditLogger.record({
        action: AuditAction.SCORING_FAILED,
        outcome: AuditOutcome.FAILURE,
        actorId: input.triggeredBy ?? null,
        resource: 'match',
        resourceId: String(input.matchId),
        errorCode: ErrorCode.SCORING_RECOMPUTE_FAILED,
        errorMessage: message,
        metadata: { durationMs },
      });
      throw err instanceof AppError
        ? err
        : new AppError(
            'Scoring recompute failed',
            HttpStatus.INTERNAL_SERVER_ERROR,
            ErrorCode.SCORING_RECOMPUTE_FAILED,
            { details: { matchId: String(input.matchId), reason: message } },
          );
    }
  }

  /**
   * Admin-driven points adjustment. Adds `delta` to a player's
   * `FantasyPoints.basePoints` and queues a recompute so every team
   * holding the player is re-scored. The delta is logged on
   * `score_events` for audit.
   */
  async adjustPlayerPoints(input: ManualPointsAdjustmentInput): Promise<void> {
    const match = await this.requireMatch(input.matchId);
    if (input.delta === 0) {
      throw new AppError(
        'Adjustment delta must be non-zero',
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const adjustmentEvent: IFantasyPointEvent = {
      code: 'ADMIN_ADJUSTMENT',
      // Penalty bucket so a manager-driven correction is easy to spot.
      category: 'BONUS' as FantasyScoringCategory,
      label: `Admin adjustment (${input.reason})`,
      rawValue: 1,
      points: input.delta,
    };

    await fantasyPointsRepository.upsert(
      { matchId: input.matchId, playerId: input.playerId },
      {
        $inc: { basePoints: input.delta, 'breakdown.bonus': input.delta },
        $push: { events: adjustmentEvent },
        $set: { computedAt: new Date() },
      },
    );

    await scoreEventRepository.create({
      matchId: input.matchId as Types.ObjectId,
      playerId: input.playerId as Types.ObjectId,
      type: ScoreEventType.POINTS_ADJUSTMENT,
      status: ScoreEventStatus.COMPLETED,
      inputRowsCount: 0,
      teamsUpdatedCount: 0,
      playersUpdatedCount: 1,
      context: { delta: input.delta, reason: input.reason },
      triggeredBy: input.actorId as unknown as Types.ObjectId,
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 0,
      errorMessage: null,
      errorCode: null,
      scoringRuleId: null,
      scoringRuleVersion: null,
    });

    await auditLogger.record({
      action: AuditAction.ADMIN_FANTASY_POINTS_ADJUSTED,
      outcome: AuditOutcome.SUCCESS,
      actorId: input.actorId,
      resource: 'player_stats',
      resourceId: String(input.playerId),
      metadata: {
        matchId: String(match._id),
        delta: input.delta,
        reason: input.reason,
      },
    });

    // Re-score every team holding the player.
    await this.recomputeForMatch({
      matchId: input.matchId,
      type: ScoreEventType.POINTS_ADJUSTMENT,
      triggeredBy: input.actorId,
      context: { delta: input.delta, playerId: String(input.playerId), reason: input.reason },
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private async requireMatch(matchId: string | Types.ObjectId): Promise<HydratedDocument<IMatch>> {
    const match = await Match.findById(matchId).exec();
    if (!match) throw new NotFoundError('Match');
    return match;
  }

  /**
   * Build the `FantasyPoints` upsert payload for every player that has
   * a stat row OR was picked by at least one fantasy team. Uses the
   * pure engine in **per-player** mode (no multiplier) so the value is
   * a clean "what did this player score in this match" number that the
   * UI can multiply on demand.
   */
  private buildPlayerPointsPayload(
    matchId: Types.ObjectId,
    statByPlayer: Map<string, Record<string, number>>,
    roleByPlayer: Map<string, PlayerRole>,
    teamByPlayer: Map<string, Types.ObjectId | null>,
    isPlayedByPlayer: Map<string, boolean>,
    isPomByPlayer: Map<string, boolean>,
    scoringRule: { _id: Types.ObjectId; version: number; events: Array<{ statKey: string }> },
    teamRule: { captainMultiplier: number; viceCaptainMultiplier: number },
  ): Array<Parameters<typeof fantasyPointsRepository.bulkUpsert>[0][number]> {
    const playerIds = new Set<string>([
      ...statByPlayer.keys(),
      ...roleByPlayer.keys(),
    ]);

    const payload: Array<Parameters<typeof fantasyPointsRepository.bulkUpsert>[0][number]> = [];

    for (const playerIdStr of playerIds) {
      const role = roleByPlayer.get(playerIdStr) ?? PlayerRole.UNKNOWN;
      const stats = statByPlayer.get(playerIdStr) ?? {};

      // Use the pure engine in "no multiplier" mode by sending isCaptain=false / isViceCaptain=false.
      const result = computeTeamPoints({
        scoringRule: scoringRule as unknown as Parameters<typeof computeTeamPoints>[0]['scoringRule'],
        teamRule,
        players: [
          {
            playerId: playerIdStr,
            role,
            isCaptain: false,
            isViceCaptain: false,
            stats,
          },
        ],
      });

      const out = result.perPlayer[0]?.output;
      if (!out) continue;

      const events: IFantasyPointEvent[] = out.appliedEvents.map((e) => ({
        code: e.code,
        category: e.category,
        label: e.label,
        rawValue: e.rawValue,
        points: e.pointsContributed,
      }));

      payload.push({
        matchId,
        playerId: new Types.ObjectId(playerIdStr),
        teamId: teamByPlayer.get(playerIdStr) ?? null,
        role,
        basePoints: out.base,
        breakdown: out.breakdown,
        events,
        scoringRuleId: scoringRule._id,
        scoringRuleVersion: scoringRule.version,
        isPlayed: isPlayedByPlayer.get(playerIdStr) ?? false,
        isPlayerOfMatch: isPomByPlayer.get(playerIdStr) ?? false,
        computedAt: new Date(),
      });
    }

    return payload;
  }

  private async persistRecompute(
    input: {
      matchId: Types.ObjectId;
      scoringRuleId: Types.ObjectId;
      scoringRuleVersion: number;
      teamUpdates: Array<{
        teamId: Types.ObjectId;
        totalPoints: number;
        breakdown: IFantasyPointBreakdown;
        perPlayer: Array<{
          playerId: Types.ObjectId;
          isCaptain: boolean;
          isViceCaptain: boolean;
          pointsEarned: number;
        }>;
      }>;
      playerPointsPayload: Array<Parameters<typeof fantasyPointsRepository.bulkUpsert>[0][number]>;
      statByPlayer: Map<string, Record<string, number>>;
    },
    session: ClientSession,
  ): Promise<{ teamsUpdated: number; playersUpdated: number }> {
    const now = new Date();

    // ── Fantasy team totals + per-player projection rows ─────────────
    let teamsUpdated = 0;
    for (const t of input.teamUpdates) {
      await FantasyTeam.updateOne(
        { _id: t.teamId },
        {
          $set: {
            totalPoints: t.totalPoints,
            pointsBreakdown: t.breakdown,
            pointsLastComputedAt: now,
          },
        },
        { session },
      ).exec();
      teamsUpdated += 1;

      // FantasyTeamPlayer projection — one updateOne per (team, player).
      // Player count per team is bounded (<= 30) so this loop is small.
      for (const pp of t.perPlayer) {
        await FantasyTeamPlayer.updateOne(
          {
            fantasyTeamId: t.teamId,
            playerId: pp.playerId,
            isDeleted: false,
          },
          {
            $set: { pointsEarned: pp.pointsEarned, pointsLastComputedAt: now },
          },
          { session },
        ).exec();
      }
    }

    // ── FantasyPoints upserts (per player, sport-agnostic) ───────────
    const bulkResult = await fantasyPointsRepository.bulkUpsert(input.playerPointsPayload, session);

    // ── Mirror to PlayerStats.fantasyPoints (capped at 0, schema min) ─
    for (const row of input.playerPointsPayload) {
      await PlayerStats.updateOne(
        { matchId: input.matchId, playerId: row.playerId },
        { $set: { fantasyPoints: Math.max(0, row.basePoints) } },
        { session },
      ).exec();
    }

    return {
      teamsUpdated,
      playersUpdated: bulkResult.matched + bulkResult.upserted,
    };
  }
}

export const scoringService = new ScoringService();
export { ScoringService };

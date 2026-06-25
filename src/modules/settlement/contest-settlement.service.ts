import crypto from 'crypto';

import { Types, type HydratedDocument } from 'mongoose';

import { logger } from '@config/logger.config';

import { ErrorCode, HttpStatus } from '@common/constants';
import {
  AuditAction,
  AuditOutcome,
  ContestEntryStatus,
  ContestSettlementStatus,
  ContestStatus,
  LeaderboardSnapshotReason,
} from '@common/enums';
import { AppError, NotFoundError } from '@common/errors/AppError';
import { auditLogger } from '@common/logging';

import { Contest, type IContest } from '@modules/contest/contest.model';
import { ContestEntry } from '@modules/contest/contest-entry.model';
import { contestEntryRepository } from '@modules/contest/contest-entry.repository';
import { contestCache } from '@modules/contest/contest-cache';
import { FantasyTeam } from '@modules/fantasy/fantasy-team.model';
import { contestResultRepository } from '@modules/leaderboard/contest-result.repository';
import type { IContestResultWinner } from '@modules/leaderboard/contest-result.model';
import { leaderboardService } from '@modules/leaderboard/leaderboard.service';
import { walletService } from '@modules/wallet/wallet.service';

import { allocateWinnings, snapshotHasPayouts } from './prize-calculator';

/**
 * Contest settlement orchestrator.
 *
 * Run sequence (one contest at a time):
 *   1. `claimForSettlement` atomically flips `contest_results.status`
 *      to IN_PROGRESS and returns a `lockToken`. If another worker
 *      already owns the lock we exit gracefully — settlement is
 *      idempotent.
 *   2. Fetch every ACTIVE entry + its FantasyTeam's totalPoints.
 *   3. Run `allocateWinnings(entries, snapshot)` — pure prize math
 *      including tie handling.
 *   4. For each entry:
 *        - `walletService.creditWinning(...)` if `winningAmount > 0`
 *          (uses entryId-prefixed idempotency key so re-runs no-op).
 *        - `markSettled` on the entry.
 *   5. Update the contest status → COMPLETED, denormalise commission.
 *   6. Rebuild the leaderboard one last time (reason = FINAL) so the
 *      FE locks to the settled ranks.
 *   7. `finalise` the `contest_results` row → SETTLED.
 *
 * Anything that throws after step 1 flips the result row to FAILED
 * with the error message; an admin can call `retry(contestId)` once
 * the underlying issue is resolved.
 */
class ContestSettlementService {
  /**
   * Public entrypoint — `force=true` skips the `match.status` guard so
   * an admin can settle early in dispute scenarios.
   */
  async settleContest(args: {
    contestId: string;
    actorId?: string | null;
    force?: boolean;
  }): Promise<{
    contestId: string;
    status: ContestSettlementStatus;
    totalEntries: number;
    totalWinners: number;
    totalPaidOut: number;
    durationMs: number;
  }> {
    const start = Date.now();
    const contest = await this.requireContest(args.contestId);

    if (!args.force) {
      // Only settle once the contest is COMPLETED (Phase 4 match status
      // bridge will flip this when match.completedAt is set).
      const settleable =
        contest.status === ContestStatus.COMPLETED || contest.status === ContestStatus.LIVE;
      if (!settleable) {
        throw new AppError(
          'Contest is not in a settleable state',
          HttpStatus.CONFLICT,
          ErrorCode.CONTEST_NOT_SETTLEABLE,
          { details: { contestId: args.contestId, status: contest.status } },
        );
      }
    }

    const existing = await contestResultRepository.findByContestId(contest._id);
    if (existing?.status === ContestSettlementStatus.SETTLED) {
      throw new AppError(
        'Contest is already settled',
        HttpStatus.CONFLICT,
        ErrorCode.CONTEST_ALREADY_SETTLED,
      );
    }

    const lockToken = crypto.randomBytes(12).toString('hex');
    const totalEntries = await contestEntryRepository.countActiveForContest(contest._id);

    const claimed = await contestResultRepository.claimForSettlement(
      {
        contestId: contest._id,
        matchId: contest.matchId,
        poolAmount: contest.prizeSnapshot.poolAmount,
        currency: contest.currency,
        totalEntries,
      },
      lockToken,
    );
    if (!claimed) {
      throw new AppError(
        'Settlement already in progress',
        HttpStatus.CONFLICT,
        ErrorCode.CONTEST_SETTLEMENT_IN_PROGRESS,
      );
    }

    await auditLogger.record({
      action: AuditAction.CONTEST_SETTLEMENT_STARTED,
      outcome: AuditOutcome.SUCCESS,
      actorId: args.actorId ?? null,
      resource: 'contest',
      resourceId: String(contest._id),
      metadata: { totalEntries, lockToken },
    });

    try {
      // Skip wallet work entirely for free / no-payout contests.
      if (totalEntries === 0) {
        const finalised = await contestResultRepository.finalise(
          contest._id,
          lockToken,
          {
            status: ContestSettlementStatus.SKIPPED,
            totalPaidOut: 0,
            commissionAmount: 0,
            totalWinners: 0,
            topScore: 0,
            uniqueWinningScores: 0,
            topEntries: [],
            durationMs: Date.now() - start,
          },
        );
        return {
          contestId: args.contestId,
          status: finalised?.status ?? ContestSettlementStatus.SKIPPED,
          totalEntries: 0,
          totalWinners: 0,
          totalPaidOut: 0,
          durationMs: Date.now() - start,
        };
      }

      // 1️⃣ Load entries + team points.
      const entries = await ContestEntry.find({
        contestId: contest._id,
        status: ContestEntryStatus.ACTIVE,
      })
        .select({ _id: 1, userId: 1, teamId: 1, joinedAt: 1 })
        .exec();
      const teamIds = entries.map((e) => e.teamId);
      const teams = await FantasyTeam.find({ _id: { $in: teamIds } })
        .select({ _id: 1, totalPoints: 1 })
        .exec();
      const teamPoints = new Map(teams.map((t) => [String(t._id), t.totalPoints ?? 0]));

      const ranked = entries.map((e) => ({
        entryId: String(e._id),
        userId: String(e.userId),
        teamId: String(e.teamId),
        points: teamPoints.get(String(e.teamId)) ?? 0,
        joinedAt: e.joinedAt,
      }));

      // 2️⃣ Pure prize allocation (handles ties).
      const allocations = allocateWinnings(ranked, contest.prizeSnapshot);
      const hasPayouts = snapshotHasPayouts(contest.prizeSnapshot);

      // 3️⃣ Persist per-entry + wallet credits (sequential — each entry
      //     write is small; an error halts the run safely).
      let totalPaidOut = 0;
      let totalWinners = 0;
      const winnerRows: IContestResultWinner[] = [];

      for (const a of allocations) {
        const shouldPay = hasPayouts && a.winningAmount > 0;
        if (shouldPay) {
          await walletService.creditWinning({
            userId: a.userId,
            amount: a.winningAmount,
            currency: contest.currency,
            idempotencyKey: `settle:${a.entryId}`,
            contestId: args.contestId,
          });
          totalPaidOut += a.winningAmount;
          totalWinners += 1;
        }
        await contestEntryRepository.markSettled(a.entryId, {
          rank: a.rank,
          winningAmount: shouldPay ? a.winningAmount : 0,
        });
        if (a.rank <= 3) {
          winnerRows.push({
            rank: a.rank,
            entryId: new Types.ObjectId(a.entryId),
            userId: new Types.ObjectId(a.userId),
            teamId: new Types.ObjectId(a.teamId),
            points: a.points,
            winningAmount: shouldPay ? a.winningAmount : 0,
            isTied: a.isTied,
          });
        }

        await auditLogger.record({
          action: AuditAction.CONTEST_ENTRY_SETTLED,
          outcome: AuditOutcome.SUCCESS,
          actorId: args.actorId ?? null,
          resource: 'contest_entry',
          resourceId: a.entryId,
          metadata: {
            contestId: args.contestId,
            rank: a.rank,
            points: a.points,
            winningAmount: shouldPay ? a.winningAmount : 0,
            isTied: a.isTied,
          },
        });
      }

      // 4️⃣ Final leaderboard rebuild — locks ranks for the FE.
      await leaderboardService.rebuildForContest({
        contestId: args.contestId,
        reason: LeaderboardSnapshotReason.FINAL,
      });

      // 5️⃣ Flip contest to COMPLETED if it wasn't already.
      if (contest.status !== ContestStatus.COMPLETED) {
        contest.status = ContestStatus.COMPLETED;
        await contest.save();
      }
      await contestCache.invalidateContest(args.contestId, String(contest.matchId));

      const topScore = allocations[0]?.points ?? 0;
      const uniqueScores = new Set(allocations.map((a) => a.points)).size;

      // 6️⃣ Mark the result row SETTLED.
      const finalised = await contestResultRepository.finalise(
        contest._id,
        lockToken,
        {
          status: ContestSettlementStatus.SETTLED,
          totalPaidOut,
          commissionAmount: Math.max(0, contest.prizeSnapshot.poolAmount - totalPaidOut),
          totalWinners,
          topScore,
          uniqueWinningScores: uniqueScores,
          topEntries: winnerRows,
          durationMs: Date.now() - start,
        },
      );

      await auditLogger.record({
        action: AuditAction.CONTEST_SETTLEMENT_COMPLETED,
        outcome: AuditOutcome.SUCCESS,
        actorId: args.actorId ?? null,
        resource: 'contest',
        resourceId: String(contest._id),
        metadata: {
          totalEntries,
          totalWinners,
          totalPaidOut,
          topScore,
          durationMs: Date.now() - start,
        },
      });
      await auditLogger.record({
        action: AuditAction.PRIZE_DISTRIBUTED,
        outcome: AuditOutcome.SUCCESS,
        actorId: args.actorId ?? null,
        resource: 'contest',
        resourceId: String(contest._id),
        metadata: { totalPaidOut, totalWinners },
      });

      return {
        contestId: args.contestId,
        status: finalised?.status ?? ContestSettlementStatus.SETTLED,
        totalEntries,
        totalWinners,
        totalPaidOut,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, contestId: args.contestId }, '[Settlement] failed');
      await contestResultRepository.finalise(contest._id, lockToken, {
        status: ContestSettlementStatus.FAILED,
        totalPaidOut: 0,
        commissionAmount: 0,
        totalWinners: 0,
        topScore: 0,
        uniqueWinningScores: 0,
        topEntries: [],
        durationMs: Date.now() - start,
        errorMessage: message,
      });
      await auditLogger.record({
        action: AuditAction.CONTEST_SETTLEMENT_FAILED,
        outcome: AuditOutcome.FAILURE,
        actorId: args.actorId ?? null,
        resource: 'contest',
        resourceId: String(contest._id),
        errorMessage: message,
        errorCode: ErrorCode.CONTEST_SETTLEMENT_FAILED,
        metadata: { durationMs: Date.now() - start },
      });
      throw err instanceof AppError
        ? err
        : new AppError(
            'Contest settlement failed',
            HttpStatus.INTERNAL_SERVER_ERROR,
            ErrorCode.CONTEST_SETTLEMENT_FAILED,
            { details: { contestId: args.contestId, reason: message } },
          );
    }
  }

  /**
   * Admin-only: reset a FAILED contest result to NOT_STARTED so the
   * worker can pick it up again. Doesn't itself trigger settlement.
   */
  async resetForRetry(contestId: string, actorId?: string | null): Promise<void> {
    const contest = await this.requireContest(contestId);
    const result = await contestResultRepository.findByContestId(contest._id);
    if (!result) {
      throw new NotFoundError('Contest result');
    }
    if (result.status !== ContestSettlementStatus.FAILED) {
      throw new AppError(
        'Only failed settlements can be retried',
        HttpStatus.CONFLICT,
        ErrorCode.CONTEST_NOT_SETTLEABLE,
      );
    }
    result.status = ContestSettlementStatus.NOT_STARTED;
    result.errorMessage = null;
    result.lockToken = null;
    result.lastTouchedBy = actorId ? new Types.ObjectId(actorId) : null;
    await result.save();
  }

  /** Read settlement progress / final result for an admin/UI view. */
  async getResult(contestId: string): Promise<HydratedDocument<IContest> & {
    result: Awaited<ReturnType<typeof contestResultRepository.findByContestId>>;
  }> {
    const contest = await this.requireContest(contestId);
    const result = await contestResultRepository.findByContestId(contest._id);
    return Object.assign(contest, { result });
  }

  // ────────────────────────────────────────────────────────────────────

  // Used only by the auto-trigger hook so cancellation doesn't cascade
  // through the worker if a stray ACTIVE entry slipped through.
  async dropLeaderboardForCancelledContest(contestId: string): Promise<void> {
    await leaderboardService.dropContest(contestId);
  }

  private async requireContest(contestId: string): Promise<HydratedDocument<IContest>> {
    if (!Types.ObjectId.isValid(contestId)) {
      throw new AppError(
        'Invalid contest id',
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    const contest = await Contest.findById(contestId).exec();
    if (!contest) throw new NotFoundError('Contest');
    return contest;
  }
}

export const contestSettlementService = new ContestSettlementService();
export { ContestSettlementService };

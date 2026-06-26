import { Types, type HydratedDocument } from 'mongoose';

import { logger } from '@config/logger.config';
import { isRedisEnabled } from '@config/redis.config';

import { AppConstants, ErrorCode, HttpStatus } from '@common/constants';
import {
  AuditAction,
  AuditOutcome,
  ContestEntryStatus,
  LeaderboardScope,
  LeaderboardSnapshotReason,
  RankMovement,
} from '@common/enums';
import { AppError, NotFoundError } from '@common/errors/AppError';
import { auditLogger } from '@common/logging';

import { Contest, type IContest } from '@modules/contest/contest.model';
import { ContestEntry } from '@modules/contest/contest-entry.model';
import { FantasyTeam } from '@modules/fantasy/fantasy-team.model';
import { User } from '@modules/user/user.model';

import { prizeForRank } from '@modules/settlement/prize-calculator';

import { realtimePublisher } from '@events/realtime.publisher';

import { leaderboardCache, LeaderboardCacheKeys, LeaderboardCacheTtl } from './leaderboard.cache';
import {
  leaderboardRedis,
  type LeaderboardZsetEntry,
} from './leaderboard-redis';
import { leaderboardSnapshotRepository } from './leaderboard-snapshot.repository';
import {
  type ILeaderboardTopEntry,
} from './leaderboard-snapshot.model';
import { rankHistoryRepository } from './rank-history.repository';
import type {
  LeaderboardPageDTO,
  LeaderboardRowDTO,
  RankHistoryDTO,
  RebuildLeaderboardInput,
  RebuildLeaderboardResult,
  UserRankDTO,
} from './leaderboard.types';

/**
 * High-level leaderboard service.
 *
 * Read paths:
 *   - `getContestPage(contestId, page)`  → paginated rows for FE
 *   - `getUserRank(contestId, userId)`   → "my rank" widget
 *   - `getRankHistory(contestId, userId)`→ time-series for the user
 *
 * Write paths:
 *   - `rebuildForContest(contestId)`     → full sync from Mongo → Redis
 *   - `recordSnapshot(contestId, ...)`   → freeze top-N + write deltas
 *
 * The service NEVER reads ranks from Mongo on hot paths — Redis sorted
 * sets are the source of truth for "what rank is each entry right now".
 * Mongo is consulted only for snapshot persistence, denormalised user
 * data, and fallback when Redis is empty.
 */
class LeaderboardService {
  // ────────────────────────────────────────────────────────────────────
  // Read paths
  // ────────────────────────────────────────────────────────────────────

  async getContestPage(args: {
    contestId: string;
    page: number;
    pageSize: number;
    userId?: string | null;
  }): Promise<LeaderboardPageDTO> {
    const page = Math.max(1, args.page);
    const pageSize = Math.min(
      AppConstants.LEADERBOARD.MAX_PAGE_SIZE,
      Math.max(1, args.pageSize),
    );
    const contest = await this.requireContest(args.contestId);

    const cacheKey = LeaderboardCacheKeys.contestPage(args.contestId, page);
    const cached = await leaderboardCache.wrap<LeaderboardPageDTO>(
      cacheKey,
      LeaderboardCacheTtl.CONTEST_PAGE,
      async () => this.loadContestPage(contest, page, pageSize, null),
    );

    // If a `userId` was supplied we need to flag the current user's row
    // — that flag isn't cached because it varies per requester.
    if (args.userId) {
      const decorated = await this.markCurrentUser(cached, args.userId, contest);
      return decorated;
    }
    return cached;
  }

  async getUserRank(args: {
    contestId: string;
    userId: string;
  }): Promise<UserRankDTO | null> {
    const contest = await this.requireContest(args.contestId);
    const entries = await ContestEntry.find({
      contestId: contest._id,
      userId: args.userId,
      status: ContestEntryStatus.ACTIVE,
    })
      .sort({ entryNumber: 1 })
      .exec();
    if (entries.length === 0) return null;

    // For multi-entry contests, return the user's best-ranked entry.
    const ids = entries.map((e) => String(e._id));
    const ranks = await leaderboardRedis.getRanks(LeaderboardScope.CONTEST, args.contestId, ids);
    const total = await leaderboardRedis.size(LeaderboardScope.CONTEST, args.contestId);

    let best: { entry: typeof entries[number]; zset: LeaderboardZsetEntry } | null = null;
    for (const e of entries) {
      const z = ranks.get(String(e._id));
      if (!z) continue;
      if (!best || (z.rank ?? Infinity) < (best.zset.rank ?? Infinity)) {
        best = { entry: e, zset: z };
      }
    }
    if (!best) return null;

    const history = await rankHistoryRepository.findLatestForEntry(
      LeaderboardScope.CONTEST,
      contest._id,
      best.entry._id,
    );

    return {
      scope: LeaderboardScope.CONTEST,
      scopeId: String(contest._id),
      entryId: String(best.entry._id),
      userId: args.userId,
      rank: best.zset.rank,
      points: best.zset.points,
      totalEntries: total,
      movement: history?.movement ?? RankMovement.NEW,
      rankDelta: history?.rankDelta ?? 0,
      pointsDelta: history?.pointsDelta ?? 0,
      projectedWinning: best.zset.rank ? prizeForRank(best.zset.rank, contest.prizeSnapshot) : null,
    };
  }

  async getRankHistory(args: {
    contestId: string;
    userId: string;
    limit?: number;
  }): Promise<RankHistoryDTO | null> {
    const contest = await this.requireContest(args.contestId);
    const entry = await ContestEntry.findOne({
      contestId: contest._id,
      userId: args.userId,
      status: ContestEntryStatus.ACTIVE,
    })
      .sort({ entryNumber: 1 })
      .exec();
    if (!entry) return null;

    const rows = await rankHistoryRepository.findRecentForEntry(
      LeaderboardScope.CONTEST,
      contest._id,
      entry._id,
      args.limit ?? 50,
    );

    return {
      scope: LeaderboardScope.CONTEST,
      scopeId: String(contest._id),
      entryId: String(entry._id),
      userId: args.userId,
      points: rows.map((r) => r.points),
      history: rows.reverse().map((r) => ({
        rank: r.rank,
        points: r.points,
        movement: r.movement,
        rankDelta: r.rankDelta,
        pointsDelta: r.pointsDelta,
        capturedAt: r.capturedAt.toISOString(),
      })),
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Write paths
  // ────────────────────────────────────────────────────────────────────

  /**
   * Rebuilds the contest leaderboard from `contest_entries` + the
   * associated `fantasy_teams.totalPoints`. Used after a recompute,
   * after a leave/refund, or as a self-heal when Redis is empty.
   */
  async rebuildForContest(input: RebuildLeaderboardInput): Promise<RebuildLeaderboardResult> {
    const contest = await this.requireContest(input.contestId);
    const start = Date.now();

    // Pull all ACTIVE/SETTLED entries + their team totals.
    const entries = await ContestEntry.find({
      contestId: contest._id,
      status: { $in: [ContestEntryStatus.ACTIVE, ContestEntryStatus.SETTLED] },
    })
      .select({ _id: 1, userId: 1, teamId: 1 })
      .exec();

    const teamIds = entries.map((e) => e.teamId);
    const teams = await FantasyTeam.find({ _id: { $in: teamIds } })
      .select({ _id: 1, totalPoints: 1, name: 1 })
      .exec();
    const teamMap = new Map(teams.map((t) => [String(t._id), t]));

    const seedEntries: Array<{ entryId: string; points: number }> = [];
    for (const e of entries) {
      const team = teamMap.get(String(e.teamId));
      const points = team?.totalPoints ?? 0;
      seedEntries.push({ entryId: String(e._id), points });
    }

    // Sort high → low so the snapshot rank assignment is deterministic
    // even if Redis is unavailable (degraded mode).
    seedEntries.sort((a, b) => b.points - a.points);

    await leaderboardRedis.rebuild(LeaderboardScope.CONTEST, input.contestId, seedEntries);

    // Snapshot + rank history rows.
    const snapshotResult = await this.recordSnapshot({
      contest,
      seedEntries,
      reason: input.reason,
      scoreEventId: input.scoreEventId ?? null,
    });

    // Bust the per-page cache so the next read pulls fresh rows.
    await leaderboardCache.invalidateContest(input.contestId);

    await auditLogger.record({
      action: AuditAction.LEADERBOARD_REBUILT,
      outcome: AuditOutcome.SUCCESS,
      actorId: input.triggeredBy ?? null,
      resource: 'contest',
      resourceId: input.contestId,
      metadata: {
        reason: input.reason,
        totalEntries: seedEntries.length,
        topScore: seedEntries[0]?.points ?? 0,
        durationMs: Date.now() - start,
      },
    });

    return {
      contestId: input.contestId,
      totalEntries: seedEntries.length,
      topScore: seedEntries[0]?.points ?? 0,
      snapshotId: snapshotResult.snapshotId,
      historyRowsWritten: snapshotResult.historyRowsWritten,
    };
  }

  /** Snapshot persistence + rank-history deltas. */
  private async recordSnapshot(args: {
    contest: HydratedDocument<IContest>;
    seedEntries: Array<{ entryId: string; points: number }>;
    reason: LeaderboardSnapshotReason;
    scoreEventId: string | null;
  }): Promise<{ snapshotId: string | null; historyRowsWritten: number }> {
    if (args.seedEntries.length === 0) {
      return { snapshotId: null, historyRowsWritten: 0 };
    }

    // Resolve top-N entries with denormalised user + team for the FE.
    const topN = args.seedEntries.slice(0, AppConstants.LEADERBOARD.TOP_N_PREVIEW);
    const topEntryIds = topN.map((t) => t.entryId);
    const topEntryDocs = await ContestEntry.find({ _id: { $in: topEntryIds } })
      .select({ _id: 1, userId: 1, teamId: 1 })
      .exec();
    const topEntryMap = new Map(topEntryDocs.map((e) => [String(e._id), e]));
    const userIds = topEntryDocs.map((e) => e.userId);
    const users = await User.find({ _id: { $in: userIds } })
      .select({ _id: 1, displayName: 1, username: 1 })
      .exec();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const topEntries: ILeaderboardTopEntry[] = topN.map((t, i) => {
      const entry = topEntryMap.get(t.entryId);
      const user = entry ? userMap.get(String(entry.userId)) : null;
      const userJson = user
        ? ((user.toJSON?.() ?? user) as {
            displayName?: string | null;
            username?: string | null;
          })
        : undefined;
      return {
        rank: i + 1,
        entryId: new Types.ObjectId(t.entryId),
        userId: entry?.userId ?? new Types.ObjectId(),
        teamId: entry?.teamId ?? new Types.ObjectId(),
        displayName: userJson?.displayName ?? userJson?.username ?? 'Player',
        points: t.points,
      };
    });

    const snapshot = await leaderboardSnapshotRepository.createSnapshot({
      scope: LeaderboardScope.CONTEST,
      scopeId: args.contest._id,
      matchId: args.contest.matchId,
      reason: args.reason,
      totalEntries: args.seedEntries.length,
      topScore: args.seedEntries[0]?.points ?? 0,
      topEntries,
      scoreEventId: args.scoreEventId,
    });

    // Build rank-history rows for *changed* entries only — compare
    // against the most recent prior row per entry.
    const ids = args.seedEntries.map((s) => s.entryId);
    const priorRows = await rankHistoryRepository.find({
      scope: LeaderboardScope.CONTEST,
      scopeId: args.contest._id,
      entryId: { $in: ids.map((id) => new Types.ObjectId(id)) },
    });
    const priorByEntry = new Map<string, { rank: number; points: number; capturedAt: Date }>();
    for (const row of priorRows) {
      const key = String(row.entryId);
      const existing = priorByEntry.get(key);
      if (!existing || row.capturedAt > existing.capturedAt) {
        priorByEntry.set(key, {
          rank: row.rank,
          points: row.points,
          capturedAt: row.capturedAt,
        });
      }
    }

    const entryDocs = await ContestEntry.find({ _id: { $in: ids } })
      .select({ _id: 1, userId: 1 })
      .exec();
    const entryUserMap = new Map(entryDocs.map((e) => [String(e._id), e.userId]));

    const historyRows: Parameters<typeof rankHistoryRepository.bulkAppend>[0] = [];
    args.seedEntries.forEach((s, i) => {
      const rank = i + 1;
      const prior = priorByEntry.get(s.entryId);
      const movement = !prior
        ? RankMovement.NEW
        : prior.rank === rank
          ? RankMovement.SAME
          : prior.rank > rank
            ? RankMovement.UP
            : RankMovement.DOWN;
      // Skip writing rows when nothing changed for an entry — keeps
      // the collection bounded over a long live match.
      if (prior && prior.rank === rank && prior.points === s.points) {
        return;
      }
      const userId = entryUserMap.get(s.entryId);
      if (!userId) return;
      historyRows.push({
        scope: LeaderboardScope.CONTEST,
        scopeId: args.contest._id,
        entryId: new Types.ObjectId(s.entryId),
        matchId: args.contest.matchId,
        userId,
        rank,
        points: s.points,
        previousRank: prior?.rank ?? null,
        previousPoints: prior?.points ?? null,
        movement,
        rankDelta: prior ? prior.rank - rank : 0,
        pointsDelta: prior ? s.points - prior.points : 0,
        snapshotId: snapshot._id,
        capturedAt: snapshot.capturedAt,
      });
    });

    const inserted = await rankHistoryRepository.bulkAppend(historyRows);

    await auditLogger.record({
      action: AuditAction.LEADERBOARD_SNAPSHOT_CREATED,
      outcome: AuditOutcome.SUCCESS,
      resource: 'leaderboard',
      resourceId: String(args.contest._id),
      metadata: {
        snapshotId: String(snapshot._id),
        rows: inserted,
        totalEntries: args.seedEntries.length,
        topScore: args.seedEntries[0]?.points ?? 0,
        reason: args.reason,
      },
    });

    return { snapshotId: String(snapshot._id), historyRowsWritten: inserted };
  }

  /** Register a newly joined entry at 0 (or current team) points. */
  async registerEntry(args: {
    contestId: string;
    entryId: string;
    points?: number;
  }): Promise<void> {
    await leaderboardRedis.upsert(
      LeaderboardScope.CONTEST,
      args.contestId,
      args.entryId,
      args.points ?? 0,
    );
    await leaderboardCache.invalidateContest(args.contestId);

    void realtimePublisher.leaderboardUpdated({
      contestId: args.contestId,
      matchId: '',
      totalEntries: 1,
      topScore: args.points ?? 0,
    });
  }

  /** Remove a single entry from Redis (refund / leave flows). */
  async removeEntry(args: {
    contestId: string;
    entryId: string;
  }): Promise<void> {
    await leaderboardRedis.remove(LeaderboardScope.CONTEST, args.contestId, args.entryId);
    await leaderboardCache.invalidateContest(args.contestId);
  }

  /** Drop the Redis ZSET entirely — used when a contest is cancelled. */
  async dropContest(contestId: string): Promise<void> {
    await leaderboardRedis.drop(LeaderboardScope.CONTEST, contestId);
    await leaderboardCache.invalidateContest(contestId);
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

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

  private async loadContestPage(
    contest: HydratedDocument<IContest>,
    page: number,
    pageSize: number,
    forUserId: string | null,
  ): Promise<LeaderboardPageDTO> {
    if (!isRedisEnabled()) {
      return this.loadContestPageFromMongo(contest, page, pageSize, forUserId);
    }

    const totalEntries = await leaderboardRedis.size(
      LeaderboardScope.CONTEST,
      String(contest._id),
    );

    // Self-heal: Redis empty but Mongo has entries → rebuild on demand.
    if (totalEntries === 0) {
      const hasEntries = await ContestEntry.exists({
        contestId: contest._id,
        status: { $in: [ContestEntryStatus.ACTIVE, ContestEntryStatus.SETTLED] },
      });
      if (hasEntries) {
        logger.info(
          { contestId: String(contest._id) },
          '[Leaderboard] Redis empty, self-healing rebuild',
        );
        await this.rebuildForContest({
          contestId: String(contest._id),
          reason: LeaderboardSnapshotReason.MANUAL,
        });
      }
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const zsetRows = await leaderboardRedis.range(
      LeaderboardScope.CONTEST,
      String(contest._id),
      from,
      to,
    );
    const finalTotal = await leaderboardRedis.size(
      LeaderboardScope.CONTEST,
      String(contest._id),
    );

    if (zsetRows.length === 0) {
      return {
        scope: LeaderboardScope.CONTEST,
        scopeId: String(contest._id),
        page,
        pageSize,
        totalEntries: finalTotal,
        topScore: 0,
        isFinal: contest.status === 'COMPLETED',
        currency: contest.currency,
        rows: [],
      };
    }

    const rows = await this.hydrateRows(contest, zsetRows, forUserId);
    return {
      scope: LeaderboardScope.CONTEST,
      scopeId: String(contest._id),
      page,
      pageSize,
      totalEntries: finalTotal,
      topScore: zsetRows[0]?.points ?? 0,
      isFinal: contest.status === 'COMPLETED',
      currency: contest.currency,
      rows,
    };
  }

  /** Mongo-backed leaderboard page when Redis is unavailable (local dev). */
  private async loadContestPageFromMongo(
    contest: HydratedDocument<IContest>,
    page: number,
    pageSize: number,
    forUserId: string | null,
  ): Promise<LeaderboardPageDTO> {
    const entries = await ContestEntry.find({
      contestId: contest._id,
      status: { $in: [ContestEntryStatus.ACTIVE, ContestEntryStatus.SETTLED] },
    })
      .select({ _id: 1, userId: 1, teamId: 1 })
      .exec();

    const teamIds = entries.map((e) => e.teamId);
    const teams = await FantasyTeam.find({ _id: { $in: teamIds } })
      .select({ _id: 1, totalPoints: 1 })
      .exec();
    const teamMap = new Map(teams.map((t) => [String(t._id), t]));

    const ranked = entries
      .map((e) => ({
        entryId: String(e._id),
        points: teamMap.get(String(e.teamId))?.totalPoints ?? 0,
      }))
      .sort((a, b) => b.points - a.points || a.entryId.localeCompare(b.entryId));

    const totalEntries = ranked.length;
    const from = (page - 1) * pageSize;
    const pageSlice = ranked.slice(from, from + pageSize).map((row, idx) => ({
      entryId: row.entryId,
      points: row.points,
      rank: from + idx + 1,
    }));

    if (pageSlice.length === 0) {
      return {
        scope: LeaderboardScope.CONTEST,
        scopeId: String(contest._id),
        page,
        pageSize,
        totalEntries,
        topScore: ranked[0]?.points ?? 0,
        isFinal: contest.status === 'COMPLETED',
        currency: contest.currency,
        rows: [],
      };
    }

    const rows = await this.hydrateRows(contest, pageSlice, forUserId);
    return {
      scope: LeaderboardScope.CONTEST,
      scopeId: String(contest._id),
      page,
      pageSize,
      totalEntries,
      topScore: ranked[0]?.points ?? 0,
      isFinal: contest.status === 'COMPLETED',
      currency: contest.currency,
      rows,
    };
  }

  private async hydrateRows(
    contest: HydratedDocument<IContest>,
    zsetRows: LeaderboardZsetEntry[],
    forUserId: string | null,
  ): Promise<LeaderboardRowDTO[]> {
    const entryIds = zsetRows.map((r) => r.entryId);
    const entries = await ContestEntry.find({ _id: { $in: entryIds } })
      .select({ _id: 1, userId: 1, teamId: 1, entryNumber: 1 })
      .exec();
    const entryMap = new Map(entries.map((e) => [String(e._id), e]));

    const userIds = entries.map((e) => e.userId);
    const teamIds = entries.map((e) => e.teamId);
    const [users, teams] = await Promise.all([
      User.find({ _id: { $in: userIds } })
        .select({ _id: 1, displayName: 1, username: 1, avatarUrl: 1 })
        .exec(),
      FantasyTeam.find({ _id: { $in: teamIds } })
        .select({ _id: 1, name: 1, accentColor: 1 })
        .exec(),
    ]);
    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const teamMap = new Map(teams.map((t) => [String(t._id), t]));

    // Prior snapshot data for movement.
    const historyRows = await rankHistoryRepository.find({
      scope: LeaderboardScope.CONTEST,
      scopeId: contest._id,
      entryId: { $in: entryIds.map((id) => new Types.ObjectId(id)) },
    });
    const latestHistory = new Map<string, { movement: RankMovement; rankDelta: number; pointsDelta: number }>();
    for (const h of historyRows) {
      const key = String(h.entryId);
      const existing = latestHistory.get(key);
      if (!existing) {
        latestHistory.set(key, {
          movement: h.movement,
          rankDelta: h.rankDelta,
          pointsDelta: h.pointsDelta,
        });
      }
    }

    return zsetRows.map((z) => {
      const entry = entryMap.get(z.entryId);
      const userJson = entry
        ? ((userMap.get(String(entry.userId))?.toJSON?.() ?? userMap.get(String(entry.userId))) as
            | { displayName?: string | null; username?: string | null; avatarUrl?: string | null }
            | undefined)
        : undefined;
      const team = entry ? teamMap.get(String(entry.teamId)) : undefined;
      const history = latestHistory.get(z.entryId);
      const projected = z.rank ? prizeForRank(z.rank, contest.prizeSnapshot) : 0;
      return {
        rank: z.rank ?? 0,
        entryId: z.entryId,
        userId: entry ? String(entry.userId) : '',
        teamId: entry ? String(entry.teamId) : '',
        displayName: userJson?.displayName ?? userJson?.username ?? team?.name ?? 'Player',
        avatarUrl: userJson?.avatarUrl ?? null,
        points: z.points,
        movement: history?.movement ?? RankMovement.NEW,
        rankDelta: history?.rankDelta ?? 0,
        pointsDelta: history?.pointsDelta ?? 0,
        projectedWinning: projected > 0 ? projected : null,
        isCurrentUser: forUserId !== null && entry !== undefined && String(entry.userId) === forUserId,
        entryNumber: entry?.entryNumber ?? 1,
        badge: null,
      };
    });
  }

  private async markCurrentUser(
    page: LeaderboardPageDTO,
    userId: string,
    contest: HydratedDocument<IContest>,
  ): Promise<LeaderboardPageDTO> {
    if (page.rows.length === 0) return page;
    return {
      ...page,
      currency: contest.currency,
      rows: page.rows.map((r) => ({ ...r, isCurrentUser: r.userId === userId })),
    };
  }
}

export const leaderboardService = new LeaderboardService();
export { LeaderboardService };

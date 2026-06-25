import { type FilterQuery, type HydratedDocument, Types } from 'mongoose';

import {
  AppConstants,
} from '@common/constants';
import {
  type MatchFormat,
  MatchStatus,
  type Sport,
  SportsProviderKey,
} from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import { Match, type IMatch } from './match.model';

interface ListFilter {
  sport?: Sport;
  status?: MatchStatus | MatchStatus[];
  format?: MatchFormat;
  tournamentId?: string | Types.ObjectId;
  teamId?: string | Types.ObjectId;
  featured?: boolean;
  from?: Date;
  to?: Date;
  q?: string;
}

class MatchRepository extends BaseRepository<IMatch> {
  constructor() {
    super(Match);
  }

  list(filters: ListFilter, pagination: PaginationParams): Promise<Paginated<HydratedDocument<IMatch>>> {
    const filter = this.buildFilter(filters);
    return this.paginate(filter, pagination, { defaultSortBy: 'scheduledAt' });
  }

  /** "Currently live" matches, sorted by start time. */
  listLive(sport?: Sport, limit = 50): Promise<Array<HydratedDocument<IMatch>>> {
    const staleCutoff = new Date(Date.now() - 8 * 60 * 60 * 1000);
    const filter: FilterQuery<IMatch> = {
      status: MatchStatus.LIVE,
      $or: [
        { startedAt: { $gte: staleCutoff } },
        { startedAt: null, scheduledAt: { $gte: staleCutoff } },
      ],
    };
    if (sport) filter.sport = sport;
    return this.find(filter, { sort: { startedAt: -1 }, limit });
  }

  /** Upcoming matches inside the rolling window (default 14 days). */
  listUpcoming(
    sport: Sport | undefined,
    windowDays = AppConstants.SPORTS.UPCOMING_WINDOW_DAYS,
    limit = 50,
  ): Promise<Array<HydratedDocument<IMatch>>> {
    const now = new Date();
    const horizon = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const filter: FilterQuery<IMatch> = {
      status: MatchStatus.UPCOMING,
      scheduledAt: { $gte: now, $lte: horizon },
    };
    if (sport) filter.sport = sport;
    return this.find(filter, { sort: { scheduledAt: 1 }, limit });
  }

  /** Admin-curated featured rail. */
  listFeatured(
    sport?: Sport,
    limit = AppConstants.SPORTS.FEATURED_MAX,
  ): Promise<Array<HydratedDocument<IMatch>>> {
    const filter: FilterQuery<IMatch> = {
      isFeatured: true,
      status: { $in: [MatchStatus.UPCOMING, MatchStatus.LIVE] },
    };
    if (sport) filter.sport = sport;
    return this.find(filter, { sort: { scheduledAt: 1 }, limit });
  }

  /** Popularity-sorted trending matches. */
  listTrending(
    sport?: Sport,
    limit = AppConstants.SPORTS.TRENDING_MAX,
  ): Promise<Array<HydratedDocument<IMatch>>> {
    const filter: FilterQuery<IMatch> = {
      status: { $in: [MatchStatus.UPCOMING, MatchStatus.LIVE] },
    };
    if (sport) filter.sport = sport;
    return this.find(filter, { sort: { popularityScore: -1, scheduledAt: 1 }, limit });
  }

  findByExternalId(providerKey: string, externalId: string): Promise<HydratedDocument<IMatch> | null> {
    return this.findOne({
      externalIds: { $elemMatch: { providerKey, id: externalId } },
    });
  }

  setFeatured(matchId: string | Types.ObjectId, isFeatured: boolean): Promise<HydratedDocument<IMatch> | null> {
    return this.updateById(matchId, { $set: { isFeatured } });
  }

  /**
   * Atomic view-count bump used to drive the popularity sort. Avoids
   * read-modify-write races by going straight through `$inc`.
   */
  incrementViewCount(matchId: string | Types.ObjectId): Promise<HydratedDocument<IMatch> | null> {
    return this.model
      .findByIdAndUpdate(
        matchId,
        { $inc: { viewCount: 1, popularityScore: 1 } },
        { new: false },
      )
      .exec();
  }

  /**
   * Closes out fixtures whose clocks have long passed but status was never
   * advanced (common when BullMQ sync is offline or mock data goes stale).
   */
  async reconcileStaleStatuses(): Promise<number> {
    const now = new Date();
    const liveCutoff = new Date(now.getTime() - 8 * 60 * 60 * 1000);
    const upcomingCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [liveResult, upcomingResult] = await Promise.all([
      this.model.updateMany(
        { status: MatchStatus.LIVE, startedAt: { $lt: liveCutoff } },
        { $set: { status: MatchStatus.COMPLETED, completedAt: now } },
      ),
      this.model.updateMany(
        { status: MatchStatus.UPCOMING, scheduledAt: { $lt: upcomingCutoff } },
        { $set: { status: MatchStatus.COMPLETED, completedAt: now } },
      ),
    ]);

    return (liveResult.modifiedCount ?? 0) + (upcomingResult.modifiedCount ?? 0);
  }

  /**
   * Closes demo LIVE rows from the mock provider when a real feed is
   * configured — prevents stale MI-vs-CSK placeholders on the home screen.
   */
  async retireMockLiveMatches(): Promise<number> {
    const now = new Date();
    const result = await this.model.updateMany(
      {
        status: MatchStatus.LIVE,
        externalIds: { $elemMatch: { providerKey: SportsProviderKey.MOCK } },
      },
      { $set: { status: MatchStatus.COMPLETED, completedAt: now } },
    );
    return result.modifiedCount ?? 0;
  }

  /**
   * Aggregation that counts matches per status / sport. Powers the admin
   * dashboard tile + future analytics.
   */
  async statusBreakdown(sport?: Sport): Promise<Array<{ status: MatchStatus; count: number }>> {
    const $match: FilterQuery<IMatch> = { isDeleted: false };
    if (sport) $match.sport = sport;
    return this.aggregate([
      { $match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { _id: 0, status: '$_id', count: 1 } },
    ]);
  }

  private buildFilter(filters: ListFilter): FilterQuery<IMatch> {
    const filter: FilterQuery<IMatch> = {};
    if (filters.sport) filter.sport = filters.sport;
    if (filters.status) {
      filter.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
    }
    if (filters.format) filter.format = filters.format;
    if (filters.tournamentId) {
      filter.tournamentId = new Types.ObjectId(String(filters.tournamentId));
    }
    if (filters.teamId) {
      const teamObjectId = new Types.ObjectId(String(filters.teamId));
      filter.$or = [{ homeTeamId: teamObjectId }, { awayTeamId: teamObjectId }];
    }
    if (filters.featured !== undefined) filter.isFeatured = filters.featured;
    if (filters.from || filters.to) {
      filter.scheduledAt = {
        ...(filters.from ? { $gte: filters.from } : {}),
        ...(filters.to ? { $lte: filters.to } : {}),
      };
    }
    if (filters.q) {
      // Text search is tied to the indexes declared on tournament + team —
      // for the match collection we fall back to a regex against the
      // resultSummary. Cross-collection joining lives in the service.
      filter.resultSummary = { $regex: filters.q, $options: 'i' };
    }
    return filter;
  }
}

export const matchRepository = new MatchRepository();
export { MatchRepository };

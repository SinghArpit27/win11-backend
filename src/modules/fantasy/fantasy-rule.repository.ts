import type { ClientSession, FilterQuery } from 'mongoose';

import { MatchFormat, Sport } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import { FantasyRule, type FantasyRuleDoc, type IFantasyRule } from './fantasy-rule.model';

interface ListFilter {
  sport?: Sport;
  format?: MatchFormat;
  isActive?: boolean;
  q?: string;
}

class FantasyRuleRepository extends BaseRepository<IFantasyRule> {
  constructor() {
    super(FantasyRule);
  }

  list(filters: ListFilter, pagination: PaginationParams): Promise<Paginated<FantasyRuleDoc>> {
    return this.paginate(this.buildFilter(filters), pagination, { defaultSortBy: 'updatedAt' });
  }

  /**
   * Look up the currently-active rule for a sport+format. Used by the
   * fantasy team service on every team create / update.
   */
  findActive(sport: Sport, format: MatchFormat): Promise<FantasyRuleDoc | null> {
    return this.findOne({ sport, format, isActive: true });
  }

  /**
   * Deactivates the currently-active rule for a (sport, format) tuple
   * so a new one can be activated in a single transaction. Returns the
   * count of rows touched — `0` is a no-op (no prior active rule).
   */
  async deactivateAllActive(
    sport: Sport,
    format: MatchFormat,
    session?: ClientSession,
  ): Promise<number> {
    const result = await FantasyRule.updateMany(
      { sport, format, isActive: true },
      { $set: { isActive: false } },
      { session },
    ).exec();
    return result.modifiedCount ?? 0;
  }

  private buildFilter(filters: ListFilter): FilterQuery<IFantasyRule> {
    const filter: FilterQuery<IFantasyRule> = {};
    if (filters.sport) filter.sport = filters.sport;
    if (filters.format) filter.format = filters.format;
    if (typeof filters.isActive === 'boolean') filter.isActive = filters.isActive;
    if (filters.q) filter.name = { $regex: filters.q, $options: 'i' };
    return filter;
  }
}

export const fantasyRuleRepository = new FantasyRuleRepository();
export { FantasyRuleRepository };

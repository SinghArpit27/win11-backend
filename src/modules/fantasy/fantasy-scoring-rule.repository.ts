import type { ClientSession, FilterQuery } from 'mongoose';

import { MatchFormat, Sport } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import {
  FantasyScoringRule,
  type FantasyScoringRuleDoc,
  type IFantasyScoringRule,
} from './fantasy-scoring-rule.model';

interface ListFilter {
  sport?: Sport;
  format?: MatchFormat;
  isActive?: boolean;
  q?: string;
}

class FantasyScoringRuleRepository extends BaseRepository<IFantasyScoringRule> {
  constructor() {
    super(FantasyScoringRule);
  }

  list(
    filters: ListFilter,
    pagination: PaginationParams,
  ): Promise<Paginated<FantasyScoringRuleDoc>> {
    return this.paginate(this.buildFilter(filters), pagination, { defaultSortBy: 'updatedAt' });
  }

  findActive(sport: Sport, format: MatchFormat): Promise<FantasyScoringRuleDoc | null> {
    return this.findOne({ sport, format, isActive: true });
  }

  async deactivateAllActive(
    sport: Sport,
    format: MatchFormat,
    session?: ClientSession,
  ): Promise<number> {
    const result = await FantasyScoringRule.updateMany(
      { sport, format, isActive: true },
      { $set: { isActive: false } },
      { session },
    ).exec();
    return result.modifiedCount ?? 0;
  }

  private buildFilter(filters: ListFilter): FilterQuery<IFantasyScoringRule> {
    const filter: FilterQuery<IFantasyScoringRule> = {};
    if (filters.sport) filter.sport = filters.sport;
    if (filters.format) filter.format = filters.format;
    if (typeof filters.isActive === 'boolean') filter.isActive = filters.isActive;
    if (filters.q) filter.name = { $regex: filters.q, $options: 'i' };
    return filter;
  }
}

export const fantasyScoringRuleRepository = new FantasyScoringRuleRepository();
export { FantasyScoringRuleRepository };

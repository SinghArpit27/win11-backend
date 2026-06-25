import type { FilterQuery } from 'mongoose';

import { PrizeDistributionType } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import {
  PrizeDistribution,
  type IPrizeDistribution,
  type PrizeDistributionDoc,
} from './prize-distribution.model';

interface PrizeDistributionListFilter {
  type?: PrizeDistributionType;
  isActive?: boolean;
  q?: string;
}

class PrizeDistributionRepository extends BaseRepository<IPrizeDistribution> {
  constructor() {
    super(PrizeDistribution);
  }

  list(
    filters: PrizeDistributionListFilter,
    pagination: PaginationParams,
  ): Promise<Paginated<PrizeDistributionDoc>> {
    return this.paginate(this.buildFilter(filters), pagination, {
      defaultSortBy: 'updatedAt',
    });
  }

  private buildFilter(filters: PrizeDistributionListFilter): FilterQuery<IPrizeDistribution> {
    const filter: FilterQuery<IPrizeDistribution> = {};
    if (filters.type) filter.type = filters.type;
    if (typeof filters.isActive === 'boolean') filter.isActive = filters.isActive;
    if (filters.q) {
      filter.$or = [
        { name: { $regex: filters.q, $options: 'i' } },
        { tags: { $regex: filters.q, $options: 'i' } },
      ];
    }
    return filter;
  }
}

export const prizeDistributionRepository = new PrizeDistributionRepository();
export { PrizeDistributionRepository };

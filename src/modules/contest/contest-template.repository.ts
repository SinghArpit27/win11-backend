import type { FilterQuery } from 'mongoose';

import { ContestType, ContestVisibility, Sport } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import {
  ContestTemplate,
  type ContestTemplateDoc,
  type IContestTemplate,
} from './contest-template.model';

interface ContestTemplateListFilter {
  type?: ContestType;
  visibility?: ContestVisibility;
  sport?: Sport;
  isActive?: boolean;
  q?: string;
}

class ContestTemplateRepository extends BaseRepository<IContestTemplate> {
  constructor() {
    super(ContestTemplate);
  }

  list(
    filters: ContestTemplateListFilter,
    pagination: PaginationParams,
  ): Promise<Paginated<ContestTemplateDoc>> {
    return this.paginate(this.buildFilter(filters), pagination, {
      defaultSortBy: 'updatedAt',
    });
  }

  findActive(): Promise<ContestTemplateDoc[]> {
    return this.find({ isActive: true }, { sort: { type: 1, entryFee: 1 } });
  }

  private buildFilter(filters: ContestTemplateListFilter): FilterQuery<IContestTemplate> {
    const filter: FilterQuery<IContestTemplate> = {};
    if (filters.type) filter.type = filters.type;
    if (filters.visibility) filter.visibility = filters.visibility;
    if (filters.sport) filter.sport = filters.sport;
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

export const contestTemplateRepository = new ContestTemplateRepository();
export { ContestTemplateRepository };

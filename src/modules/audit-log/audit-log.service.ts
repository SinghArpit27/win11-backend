import type { FilterQuery } from 'mongoose';

import { BaseService } from '@shared/services/base.service';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { auditLogRepository } from './audit-log.repository';
import type { IAuditLog } from './audit-log.model';
import type { ListAuditLogsQuery } from './audit-log.validators';

class AuditLogService extends BaseService {
  constructor() {
    super('audit-log-service');
  }

  list(query: ListAuditLogsQuery): Promise<Paginated<IAuditLog>> {
    const filter: FilterQuery<IAuditLog> = {};
    if (query.action) filter.action = query.action;
    if (query.outcome) filter.outcome = query.outcome;
    if (query.actorId) filter.actorId = query.actorId;
    if (query.onBehalfOfId) filter.onBehalfOfId = query.onBehalfOfId;
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) filter.createdAt.$gte = query.from;
      if (query.to) filter.createdAt.$lte = query.to;
    }

    const params: PaginationParams = {
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };
    return auditLogRepository.paginate(filter, params, {
      defaultSortBy: 'createdAt',
    }) as unknown as Promise<Paginated<IAuditLog>>;
  }
}

export const auditLogService = new AuditLogService();
export { AuditLogService };

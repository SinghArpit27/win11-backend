import { BaseRepository } from '@shared/repositories/base.repository';

import { AuditLog, type IAuditLog } from './audit-log.model';

class AuditLogRepository extends BaseRepository<IAuditLog> {
  constructor() {
    super(AuditLog);
  }
}

export const auditLogRepository = new AuditLogRepository();
export { AuditLogRepository };

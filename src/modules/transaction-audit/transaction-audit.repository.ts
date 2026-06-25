import { BaseRepository } from '@shared/repositories/base.repository';

import { TransactionAudit, type ITransactionAudit } from './transaction-audit.model';

class TransactionAuditRepository extends BaseRepository<ITransactionAudit> {
  constructor() {
    super(TransactionAudit);
  }
}

export const transactionAuditRepository = new TransactionAuditRepository();

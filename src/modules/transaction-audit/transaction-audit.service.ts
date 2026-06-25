import { randomUUID } from 'node:crypto';

import { TransactionAuditAction } from '@common/enums';

import { TransactionAudit } from './transaction-audit.model';

class TransactionAuditService {
  async record(args: {
    action: TransactionAuditAction;
    userId: string | null;
    referenceType: string;
    referenceId: string;
    metadata?: Record<string, unknown>;
    correlationId?: string;
  }): Promise<void> {
    await TransactionAudit.create({
      action: args.action,
      userId: args.userId,
      referenceType: args.referenceType,
      referenceId: args.referenceId,
      metadata: args.metadata ?? {},
      correlationId: args.correlationId ?? randomUUID(),
    });
  }

  list(filters: { userId?: string; referenceType?: string }, pagination: { page: number; limit: number }) {
    const query: Record<string, unknown> = {};
    if (filters.userId) query.userId = filters.userId;
    if (filters.referenceType) query.referenceType = filters.referenceType;
    const skip = (pagination.page - 1) * pagination.limit;
    return Promise.all([
      TransactionAudit.find(query).sort({ createdAt: -1 }).skip(skip).limit(pagination.limit).exec(),
      TransactionAudit.countDocuments(query),
    ]);
  }
}

export const transactionAuditService = new TransactionAuditService();

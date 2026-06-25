import type { ClientSession, HydratedDocument, Types } from 'mongoose';

import { LedgerDirection, WalletBucket } from '@common/enums';

import { BaseRepository } from '@shared/repositories/base.repository';

import {
  TransactionLedger,
  type ITransactionLedger,
} from './transaction-ledger.model';

class TransactionLedgerRepository extends BaseRepository<ITransactionLedger> {
  constructor() {
    super(TransactionLedger);
  }

  insertEntries(
    entries: Array<Partial<ITransactionLedger>>,
    session?: ClientSession,
  ): Promise<HydratedDocument<ITransactionLedger>[]> {
    return this.model.create(entries, { session, ordered: true });
  }

  listForTransaction(
    transactionId: string | Types.ObjectId,
  ): Promise<HydratedDocument<ITransactionLedger>[]> {
    return this.model.find({ transactionId }).sort({ sequence: 1 }).exec();
  }

  /**
   * Reconstructs a per-bucket balance from raw journal entries. Used by
   * reconciliation jobs and by the audit screen ("computed vs cached").
   */
  async computeBucketBalance(
    walletId: string | Types.ObjectId,
    bucket: WalletBucket,
  ): Promise<number> {
    const [result] = await this.aggregate<{ credit: number; debit: number }>([
      { $match: { walletId, bucket, isDeleted: false } },
      {
        $group: {
          _id: null,
          credit: {
            $sum: {
              $cond: [{ $eq: ['$direction', LedgerDirection.CREDIT] }, '$amount', 0],
            },
          },
          debit: {
            $sum: {
              $cond: [{ $eq: ['$direction', LedgerDirection.DEBIT] }, '$amount', 0],
            },
          },
        },
      },
    ]);
    if (!result) return 0;
    return result.credit - result.debit;
  }
}

export const transactionLedgerRepository = new TransactionLedgerRepository();
export { TransactionLedgerRepository };

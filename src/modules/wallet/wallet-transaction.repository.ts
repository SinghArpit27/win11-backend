import type { ClientSession, FilterQuery, HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';

import { WalletTxStatus, WalletTxType } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import {
  WalletTransaction,
  type IWalletTransaction,
} from './wallet-transaction.model';

class WalletTransactionRepository extends BaseRepository<IWalletTransaction> {
  constructor() {
    super(WalletTransaction);
  }

  /**
   * Returns a transaction by idempotency key. Used by the wallet service
   * BEFORE attempting a new write so retried HTTP requests collapse to
   * the original transaction.
   */
  findByIdempotencyKey(
    userId: string | Types.ObjectId,
    idempotencyKey: string,
    session?: ClientSession,
  ): Promise<HydratedDocument<IWalletTransaction> | null> {
    return this.model
      .findOne({ userId, idempotencyKey })
      .session(session ?? null)
      .exec();
  }

  markCompleted(
    txnId: string | Types.ObjectId,
    balanceAfter: IWalletTransaction['balanceAfter'],
    session?: ClientSession,
  ): Promise<HydratedDocument<IWalletTransaction> | null> {
    return this.model
      .findByIdAndUpdate(
        txnId,
        {
          $set: {
            status: WalletTxStatus.COMPLETED,
            balanceAfter,
            completedAt: new Date(),
          },
        },
        { new: true, session: session ?? null },
      )
      .exec();
  }

  markFailed(
    txnId: string | Types.ObjectId,
    reason: string,
    session?: ClientSession,
  ): Promise<HydratedDocument<IWalletTransaction> | null> {
    return this.model
      .findByIdAndUpdate(
        txnId,
        {
          $set: {
            status: WalletTxStatus.FAILED,
            failedAt: new Date(),
            failureReason: reason,
          },
        },
        { new: true, session: session ?? null },
      )
      .exec();
  }

  markReversed(
    txnId: string | Types.ObjectId,
    reversedById: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<HydratedDocument<IWalletTransaction> | null> {
    return this.model
      .findByIdAndUpdate(
        txnId,
        {
          $set: {
            status: WalletTxStatus.REVERSED,
            reversedById,
          },
        },
        { new: true, session: session ?? null },
      )
      .exec();
  }

  async listForUser(
    userId: string | Types.ObjectId,
    filters: {
      type?: WalletTxType;
      status?: WalletTxStatus;
      from?: Date;
      to?: Date;
    },
    pagination: PaginationParams,
  ): Promise<Paginated<HydratedDocument<IWalletTransaction>>> {
    const filter: FilterQuery<IWalletTransaction> = { userId };
    if (filters.type) filter.type = filters.type;
    if (filters.status) filter.status = filters.status;
    if (filters.from || filters.to) {
      filter.createdAt = {
        ...(filters.from ? { $gte: filters.from } : {}),
        ...(filters.to ? { $lte: filters.to } : {}),
      };
    }
    return this.paginate(filter, pagination, { defaultSortBy: 'createdAt' });
  }

  async listForAdmin(
    filters: {
      userId?: string;
      type?: WalletTxType;
      status?: WalletTxStatus;
      from?: Date;
      to?: Date;
      reference?: string;
    },
    pagination: PaginationParams,
  ): Promise<Paginated<HydratedDocument<IWalletTransaction>>> {
    const filter: FilterQuery<IWalletTransaction> = {};
    if (filters.userId) filter.userId = new Types.ObjectId(filters.userId);
    if (filters.type) filter.type = filters.type;
    if (filters.status) filter.status = filters.status;
    if (filters.reference) filter.reference = filters.reference;
    if (filters.from || filters.to) {
      filter.createdAt = {
        ...(filters.from ? { $gte: filters.from } : {}),
        ...(filters.to ? { $lte: filters.to } : {}),
      };
    }
    return this.paginate(filter, pagination, { defaultSortBy: 'createdAt' });
  }

  /** Aggregate sum per type for the wallet summary dashboard. */
  async summaryForUser(userId: string | Types.ObjectId): Promise<
    Array<{ type: WalletTxType; total: number; count: number }>
  > {
    return this.aggregate([
      {
        $match: {
          userId: new Types.ObjectId(String(userId)),
          status: WalletTxStatus.COMPLETED,
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: '$type',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, type: '$_id', total: 1, count: 1 } },
    ]);
  }
}

export const walletTransactionRepository = new WalletTransactionRepository();
export { WalletTransactionRepository };

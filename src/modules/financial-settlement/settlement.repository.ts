import type { HydratedDocument, Types } from 'mongoose';

import { FinancialSettlementStatus } from '@common/enums';

import { BaseRepository } from '@shared/repositories/base.repository';

import { FinancialSettlement, type IFinancialSettlement } from './settlement.model';

class SettlementRepository extends BaseRepository<IFinancialSettlement> {
  constructor() {
    super(FinancialSettlement);
  }

  findByIdempotencyKey(key: string): Promise<HydratedDocument<IFinancialSettlement> | null> {
    return this.model.findOne({ idempotencyKey: key }).exec();
  }

  markProcessing(id: string | Types.ObjectId): Promise<HydratedDocument<IFinancialSettlement> | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        { $inc: { attempts: 1 }, $set: { status: FinancialSettlementStatus.PROCESSING } },
        { new: true },
      )
      .exec();
  }

  markCompleted(id: string | Types.ObjectId): Promise<HydratedDocument<IFinancialSettlement> | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        { $set: { status: FinancialSettlementStatus.COMPLETED, completedAt: new Date() } },
        { new: true },
      )
      .exec();
  }

  markFailed(id: string | Types.ObjectId, error: string): Promise<HydratedDocument<IFinancialSettlement> | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        { $set: { status: FinancialSettlementStatus.FAILED, lastError: error } },
        { new: true },
      )
      .exec();
  }

  markDeadLetter(id: string | Types.ObjectId, error: string): Promise<HydratedDocument<IFinancialSettlement> | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        { $set: { status: FinancialSettlementStatus.DEAD_LETTER, lastError: error } },
        { new: true },
      )
      .exec();
  }
}

export const settlementRepository = new SettlementRepository();

import type { HydratedDocument, Types } from 'mongoose';

import { PaymentStatus } from '@common/enums';

import { BaseRepository } from '@shared/repositories/base.repository';

import { Payment, type IPayment } from './payment.model';

class PaymentRepository extends BaseRepository<IPayment> {
  constructor() {
    super(Payment);
  }

  findByIdempotencyKey(
    userId: string | Types.ObjectId,
    idempotencyKey: string,
  ): Promise<HydratedDocument<IPayment> | null> {
    return this.model.findOne({ userId, idempotencyKey }).exec();
  }

  findByProviderOrderId(providerOrderId: string): Promise<HydratedDocument<IPayment> | null> {
    return this.model.findOne({ providerOrderId }).exec();
  }

  findByProviderPaymentId(providerPaymentId: string): Promise<HydratedDocument<IPayment> | null> {
    return this.model.findOne({ providerPaymentId }).exec();
  }

  markCaptured(
    id: string | Types.ObjectId,
    update: {
      providerPaymentId: string;
      providerSignature?: string | null;
      settlementId?: Types.ObjectId | string | null;
    },
  ): Promise<HydratedDocument<IPayment> | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: PaymentStatus.CAPTURED,
            providerPaymentId: update.providerPaymentId,
            providerSignature: update.providerSignature ?? null,
            settlementId: update.settlementId ?? null,
          },
        },
        { new: true },
      )
      .exec();
  }

  markSettled(
    id: string | Types.ObjectId,
    walletTransactionId: Types.ObjectId | string,
  ): Promise<HydratedDocument<IPayment> | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        { $set: { walletTransactionId, status: PaymentStatus.CAPTURED } },
        { new: true },
      )
      .exec();
  }

  markFailed(
    id: string | Types.ObjectId,
    failure: { code: string; reason: string },
  ): Promise<HydratedDocument<IPayment> | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: PaymentStatus.FAILED,
            failureCode: failure.code,
            failureReason: failure.reason,
          },
        },
        { new: true },
      )
      .exec();
  }
}

export const paymentRepository = new PaymentRepository();

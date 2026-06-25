import type { ClientSession, HydratedDocument, Types } from 'mongoose';

import { PaymentAttemptStatus } from '@common/enums';

import { BaseRepository } from '@shared/repositories/base.repository';

import { PaymentAttempt, type IPaymentAttempt } from './payment-attempt.model';

class PaymentAttemptRepository extends BaseRepository<IPaymentAttempt> {
  constructor() {
    super(PaymentAttempt);
  }

  findByIdempotencyKey(
    userId: string | Types.ObjectId,
    idempotencyKey: string,
  ): Promise<HydratedDocument<IPaymentAttempt> | null> {
    return this.model.findOne({ userId, idempotencyKey }).exec();
  }

  markSuccess(
    id: string | Types.ObjectId,
    update: {
      walletTransactionId: Types.ObjectId | string;
      providerPaymentId?: string | null;
    },
    session?: ClientSession,
  ): Promise<HydratedDocument<IPaymentAttempt> | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: PaymentAttemptStatus.SUCCESS,
            completedAt: new Date(),
            walletTransactionId: update.walletTransactionId,
            providerPaymentId: update.providerPaymentId ?? null,
          },
        },
        { new: true, session: session ?? null },
      )
      .exec();
  }

  markFailed(
    id: string | Types.ObjectId,
    failure: { code: string; reason: string },
  ): Promise<HydratedDocument<IPaymentAttempt> | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: PaymentAttemptStatus.FAILED,
            failureCode: failure.code,
            failureReason: failure.reason,
          },
        },
        { new: true },
      )
      .exec();
  }
}

export const paymentAttemptRepository = new PaymentAttemptRepository();
export { PaymentAttemptRepository };

import type { HydratedDocument } from 'mongoose';

import { OtpChannel, OtpPurpose } from '@common/enums';

import { BaseRepository } from '@shared/repositories/base.repository';

import { AuthOtp, type IAuthOtp } from './auth-otp.model';

class AuthOtpRepository extends BaseRepository<IAuthOtp> {
  constructor() {
    super(AuthOtp);
  }

  findActive(
    identifier: string,
    purpose: OtpPurpose,
  ): Promise<HydratedDocument<IAuthOtp> | null> {
    return this.model
      .findOne({
        identifier: identifier.toLowerCase(),
        purpose,
        consumedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .select('+codeHash')
      .sort({ createdAt: -1 })
      .exec();
  }

  recentRequestCount(
    identifier: string,
    purpose: OtpPurpose,
    sinceMs: number,
  ): Promise<number> {
    return this.model
      .countDocuments({
        identifier: identifier.toLowerCase(),
        purpose,
        createdAt: { $gt: new Date(Date.now() - sinceMs) },
      })
      .exec();
  }

  consume(id: string): Promise<HydratedDocument<IAuthOtp> | null> {
    return this.updateById(id, { $set: { consumedAt: new Date() } });
  }

  decrementAttempts(id: string): Promise<HydratedDocument<IAuthOtp> | null> {
    return this.updateById(id, { $inc: { attemptsRemaining: -1 } });
  }

  invalidateActive(
    identifier: string,
    purpose: OtpPurpose,
    channel: OtpChannel,
  ): Promise<{ acknowledged: boolean; modifiedCount: number }> {
    return this.model
      .updateMany(
        {
          identifier: identifier.toLowerCase(),
          purpose,
          channel,
          consumedAt: null,
        },
        { $set: { consumedAt: new Date() } },
      )
      .exec();
  }
}

export const authOtpRepository = new AuthOtpRepository();
export { AuthOtpRepository };

import type { FilterQuery, HydratedDocument } from 'mongoose';

import { BaseRepository } from '@shared/repositories/base.repository';

import { User, type IUser } from './user.model';

/**
 * Data access for the `users` collection. Keep it boring — repositories
 * never call services / loggers / external APIs.
 */
class UserRepository extends BaseRepository<IUser> {
  constructor() {
    super(User);
  }

  findByEmail(email: string, includePassword = false): Promise<HydratedDocument<IUser> | null> {
    const query = this.model.findOne({ email: email.toLowerCase() });
    if (includePassword) query.select('+passwordHash');
    return query.exec();
  }

  findByPhone(phone: string, includePassword = false): Promise<HydratedDocument<IUser> | null> {
    const query = this.model.findOne({ phone });
    if (includePassword) query.select('+passwordHash');
    return query.exec();
  }

  findByIdentifier(
    identifier: string,
    includePassword = false,
  ): Promise<HydratedDocument<IUser> | null> {
    const filter: FilterQuery<IUser> = identifier.includes('@')
      ? { email: identifier.toLowerCase() }
      : { phone: identifier };
    const query = this.model.findOne(filter);
    if (includePassword) query.select('+passwordHash');
    return query.exec();
  }

  bumpFailedLogin(userId: string, lockedUntil?: Date): Promise<HydratedDocument<IUser> | null> {
    return this.model
      .findByIdAndUpdate(
        userId,
        {
          $inc: { failedLoginCount: 1 },
          ...(lockedUntil ? { $set: { lockedUntil } } : {}),
        },
        { new: true },
      )
      .exec();
  }

  resetFailedLogin(userId: string, ip?: string): Promise<HydratedDocument<IUser> | null> {
    return this.model
      .findByIdAndUpdate(
        userId,
        {
          $set: {
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
            lastLoginIp: ip ?? null,
          },
        },
        { new: true },
      )
      .exec();
  }

  markEmailVerified(userId: string): Promise<HydratedDocument<IUser> | null> {
    return this.updateById(userId, {
      $set: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
  }

  markPhoneVerified(userId: string): Promise<HydratedDocument<IUser> | null> {
    return this.updateById(userId, {
      $set: { phoneVerifiedAt: new Date(), status: 'ACTIVE' },
    });
  }

  updatePasswordHash(userId: string, passwordHash: string): Promise<HydratedDocument<IUser> | null> {
    return this.updateById(userId, {
      $set: { passwordHash, passwordChangedAt: new Date() },
    });
  }
}

export const userRepository = new UserRepository();
export { UserRepository };

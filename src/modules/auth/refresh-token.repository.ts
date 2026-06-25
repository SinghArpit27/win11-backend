import type { HydratedDocument } from 'mongoose';

import { BaseRepository } from '@shared/repositories/base.repository';

import { RefreshToken, type IRefreshToken } from './refresh-token.model';

class RefreshTokenRepository extends BaseRepository<IRefreshToken> {
  constructor() {
    super(RefreshToken);
  }

  findByHash(tokenHash: string): Promise<HydratedDocument<IRefreshToken> | null> {
    return this.model.findOne({ tokenHash }).select('+tokenHash').exec();
  }

  findByJti(jti: string): Promise<HydratedDocument<IRefreshToken> | null> {
    return this.model.findOne({ jti }).exec();
  }

  markRotated(
    id: string,
    rotatedToId: string,
  ): Promise<HydratedDocument<IRefreshToken> | null> {
    return this.updateById(id, {
      $set: { revokedAt: new Date(), rotatedTo: rotatedToId },
    });
  }

  markReuse(id: string): Promise<HydratedDocument<IRefreshToken> | null> {
    return this.updateById(id, {
      $set: { reuseDetectedAt: new Date(), revokedAt: new Date() },
    });
  }

  revokeForSession(sessionId: string): Promise<{ acknowledged: boolean; modifiedCount: number }> {
    return this.model
      .updateMany(
        { sessionId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      )
      .exec();
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
export { RefreshTokenRepository };

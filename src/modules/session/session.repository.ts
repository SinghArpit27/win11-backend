import type { HydratedDocument } from 'mongoose';

import { SessionStatus } from '@common/enums';

import { BaseRepository } from '@shared/repositories/base.repository';

import { Session, type ISession } from './session.model';

class SessionRepository extends BaseRepository<ISession> {
  constructor() {
    super(Session);
  }

  findActiveByUser(userId: string): Promise<HydratedDocument<ISession>[]> {
    return this.model
      .find({ userId, status: SessionStatus.ACTIVE })
      .sort({ lastUsedAt: -1 })
      .exec();
  }

  touch(sessionId: string): Promise<HydratedDocument<ISession> | null> {
    return this.updateById(sessionId, { $set: { lastUsedAt: new Date() } });
  }

  revoke(sessionId: string, reason: string): Promise<HydratedDocument<ISession> | null> {
    return this.updateById(sessionId, {
      $set: {
        status: SessionStatus.REVOKED,
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });
  }

  revokeAllForUser(
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<{ acknowledged: boolean; modifiedCount: number }> {
    const filter = exceptSessionId
      ? { userId, status: SessionStatus.ACTIVE, _id: { $ne: exceptSessionId } }
      : { userId, status: SessionStatus.ACTIVE };
    return this.model
      .updateMany(filter, {
        $set: {
          status: SessionStatus.REVOKED,
          revokedAt: new Date(),
          revokedReason: reason,
        },
      })
      .exec();
  }
}

export const sessionRepository = new SessionRepository();
export { SessionRepository };

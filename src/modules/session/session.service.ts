import type { Request } from 'express';

import { AuditAction } from '@common/enums';
import { ForbiddenError, NotFoundError } from '@common/errors';
import { auditLogger } from '@common/logging';

import { BaseService } from '@shared/services/base.service';

import { refreshTokenRepository } from '@modules/auth/refresh-token.repository';

import { sessionRepository } from './session.repository';
import type { ISession } from './session.model';

class SessionService extends BaseService {
  constructor() {
    super('session-service');
  }

  listMine(userId: string): Promise<ISession[]> {
    return sessionRepository.findActiveByUser(userId) as unknown as Promise<ISession[]>;
  }

  async revokeMine(
    userId: string,
    sessionId: string,
    currentSessionId: string,
    req: Request,
  ): Promise<void> {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw new NotFoundError('Session');
    if (String(session.userId) !== userId) throw new ForbiddenError('Not your session');

    await sessionRepository.revoke(sessionId, 'user_revoked_device');
    await refreshTokenRepository.revokeForSession(sessionId);

    await auditLogger.success({
      actorId: userId,
      action:
        sessionId === currentSessionId ? AuditAction.USER_LOGOUT : AuditAction.SESSION_REVOKED,
      resource: 'session',
      resourceId: sessionId,
      req,
    });
  }

  async adminRevokeAllForUser(
    actorId: string,
    actorRoles: string[],
    targetUserId: string,
    req: Request,
  ): Promise<number> {
    const result = await sessionRepository.revokeAllForUser(targetUserId, 'admin_force_logout');
    await auditLogger.success({
      actorId,
      actorRoles,
      onBehalfOfId: targetUserId,
      action: AuditAction.ADMIN_SESSIONS_REVOKED,
      resource: 'user',
      resourceId: targetUserId,
      metadata: { revoked: result.modifiedCount },
      req,
    });
    return result.modifiedCount;
  }
}

export const sessionService = new SessionService();
export { SessionService };

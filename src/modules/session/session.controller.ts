import type { Request, Response } from 'express';

import { asyncHandler, sendSuccess } from '@common/utils';

import { sessionService } from './session.service';

export const listMySessionsController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new Error('unreachable — guarded by requireAuth');
  const sessions = await sessionService.listMine(req.user.id);
  return sendSuccess(res, {
    sessions: sessions.map((s) => ({
      id: String(s._id),
      platform: s.platform,
      deviceId: s.deviceId,
      userAgent: s.userAgent,
      ip: s.ip,
      ipCountry: s.ipCountry,
      issuedAt: s.issuedAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      isCurrent: String(s._id) === req.user?.sessionId,
    })),
  });
});

export const revokeMySessionController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new Error('unreachable — guarded by requireAuth');
  await sessionService.revokeMine(
    req.user.id,
    (req.params as { sessionId: string }).sessionId,
    req.user.sessionId,
    req,
  );
  return sendSuccess(res, { revoked: true });
});

export const adminRevokeAllSessionsController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new Error('unreachable — guarded by requireAuth');
    const count = await sessionService.adminRevokeAllForUser(
      req.user.id,
      req.user.roles,
      (req.params as { userId: string }).userId,
      req,
    );
    return sendSuccess(res, { revoked: count });
  },
);

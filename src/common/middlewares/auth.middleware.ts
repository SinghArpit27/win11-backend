import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ErrorCode } from '@common/constants';
import { SessionStatus, UserRole, UserStatus } from '@common/enums';
import { ForbiddenError, UnauthorizedError } from '@common/errors';
import { verifyAccessToken } from '@common/utils/jwt.util';

import { Session } from '@modules/session/session.model';
import { User } from '@modules/user/user.model';

/**
 * Authentication middleware.
 *
 * Hot path:
 *  1. Verify access token signature + claims.
 *  2. Load the user row (status + roles) — single indexed lookup.
 *  3. Validate session is still ACTIVE (logout / revocation respected).
 *  4. Populate `req.user` for downstream RBAC checks.
 *
 * The middleware is intentionally strict: any mismatch becomes a
 * 401 (UNAUTHORIZED) so client refresh / re-auth flows behave predictably.
 */
export const requireAuth: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const header = req.header('authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }
    const token = header.slice(7).trim();
    if (!token) throw new UnauthorizedError('Empty bearer token');

    const claims = verifyAccessToken(token);
    if (!claims.sub) throw new UnauthorizedError('Invalid token', ErrorCode.TOKEN_INVALID);
    if (!claims.sessionId) {
      throw new UnauthorizedError('Invalid token', ErrorCode.TOKEN_INVALID);
    }

    const [user, session] = await Promise.all([
      User.findById(claims.sub).select('roles status email phone').lean(),
      Session.findById(claims.sessionId).select('status userId expiresAt').lean(),
    ]);

    if (!user) throw new UnauthorizedError('User not found', ErrorCode.TOKEN_INVALID);
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedError('Account suspended', ErrorCode.ACCOUNT_SUSPENDED);
    }
    if (user.status === UserStatus.DELETED) {
      throw new UnauthorizedError('Account disabled', ErrorCode.ACCOUNT_DISABLED);
    }

    if (!session || String(session.userId) !== String(user._id)) {
      throw new UnauthorizedError('Session not found', ErrorCode.SESSION_NOT_FOUND);
    }
    if (session.status !== SessionStatus.ACTIVE) {
      throw new UnauthorizedError('Session revoked', ErrorCode.SESSION_REVOKED);
    }
    if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError('Session expired', ErrorCode.TOKEN_EXPIRED);
    }

    const roles = (user.roles ?? [UserRole.USER]) as UserRole[];
    req.user = {
      id: String(user._id),
      role: roles[0] ?? UserRole.USER,
      roles,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      sessionId: String(session._id),
    };
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Optional auth — sets `req.user` when a valid token is provided.
 *
 * Public feeds (matches, contests) must stay reachable even when the caller
 * sends a stale or invalid token. Auth failures are swallowed and the request
 * proceeds anonymously instead of returning 401/500.
 */
export const optionalAuth: RequestHandler = (req, res, next) => {
  if (!req.header('authorization')) return next();
  requireAuth(req, res, (err) => {
    if (err) {
      delete req.user;
      return next();
    }
    next();
  });
};

/**
 * RBAC guard — pass after `requireAuth`. Caller satisfies the guard if
 * ANY of their roles intersects the required set.
 *
 * Example: `router.post('/admin', requireAuth, requireRoles(UserRole.ADMIN))`
 */
export const requireRoles =
  (...roles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    const has = req.user.roles.some((r) => roles.includes(r));
    if (!has) return next(new ForbiddenError('Insufficient role'));
    next();
  };

/**
 * Permission guard — checks string-keyed permissions held by the role.
 * Phase 2 ships role-level RBAC; this hook is reserved for fine-grained
 * permissions managed via the Role collection (used by admin panel
 * "permission editor" in Phase 10).
 */
export const requirePermissions =
  (..._permissions: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    // Phase 2: roles imply permissions. Permission rows on roles collection
    // are checked here once the admin permission editor lands.
    next();
  };

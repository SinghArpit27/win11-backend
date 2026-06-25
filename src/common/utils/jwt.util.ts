import jwt, { JwtPayload, SignOptions, VerifyOptions } from 'jsonwebtoken';

import { env } from '@config/env.config';

import { ErrorCode } from '@common/constants';
import { TokenType } from '@common/enums';
import { UnauthorizedError } from '@common/errors';

/**
 * JWT helper. Single source of truth for sign/verify; never call `jsonwebtoken`
 * directly from feature code.
 *
 * - Access tokens : short TTL, signed with `JWT_ACCESS_SECRET`.
 * - Refresh tokens: long TTL, signed with `JWT_REFRESH_SECRET`, also stored
 *                   server-side as a hashed session for rotation/revocation.
 */

export interface JwtClaims extends JwtPayload {
  sub: string;
  type: TokenType;
  sessionId?: string;
  role?: string;
}

const baseSignOptions: SignOptions = {
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  algorithm: 'HS256',
};

const baseVerifyOptions: VerifyOptions = {
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  algorithms: ['HS256'],
};

export const signAccessToken = (payload: Omit<JwtClaims, 'type'>): string =>
  jwt.sign({ ...payload, type: TokenType.ACCESS }, env.JWT_ACCESS_SECRET, {
    ...baseSignOptions,
    expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
  });

export const signRefreshToken = (payload: Omit<JwtClaims, 'type'>): string =>
  jwt.sign({ ...payload, type: TokenType.REFRESH }, env.JWT_REFRESH_SECRET, {
    ...baseSignOptions,
    expiresIn: env.JWT_REFRESH_TTL as SignOptions['expiresIn'],
  });

const verify = (token: string, secret: string): JwtClaims => {
  try {
    return jwt.verify(token, secret, baseVerifyOptions) as JwtClaims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Token expired', ErrorCode.TOKEN_EXPIRED);
    }
    throw new UnauthorizedError('Invalid token', ErrorCode.TOKEN_INVALID);
  }
};

export const verifyAccessToken = (token: string): JwtClaims => verify(token, env.JWT_ACCESS_SECRET);

export const verifyRefreshToken = (token: string): JwtClaims =>
  verify(token, env.JWT_REFRESH_SECRET);

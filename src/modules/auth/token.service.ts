import crypto from 'node:crypto';

import { type Types } from 'mongoose';
import { v4 as uuid } from 'uuid';

import { env } from '@config/env.config';

import { signAccessToken, signRefreshToken, type JwtClaims } from '@common/utils/jwt.util';

import { BaseService } from '@shared/services/base.service';

import { refreshTokenRepository } from './refresh-token.repository';

/**
 * Single source of truth for token issuance + rotation.
 *
 * Why a separate service?
 *  - keeps `auth.service` focused on user-facing flows,
 *  - encapsulates hash/sign/persist so reuse-detection logic is in one
 *    place (called by login, refresh, password-reset, OTP-login).
 */
export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: string;
  refreshExpiresIn: string;
  refreshTokenId: Types.ObjectId | string;
}

class TokenService extends BaseService {
  constructor() {
    super('token-service');
  }

  /** sha256 → hex. Refresh tokens are NEVER stored in plain. */
  private hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private parseDurationMs(spec: string): number {
    const m = /^(\d+)([smhd])$/.exec(spec);
    if (!m) return 30 * 24 * 60 * 60 * 1000;
    const n = Number(m[1]);
    const unit = m[2] as 's' | 'm' | 'h' | 'd';
    const factors: Record<'s' | 'm' | 'h' | 'd', number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return n * factors[unit];
  }

  async issuePair(input: {
    userId: string;
    sessionId: string;
    role: string;
    roles?: string[];
  }): Promise<IssuedTokenPair> {
    const accessClaims: Omit<JwtClaims, 'type'> = {
      sub: input.userId,
      sessionId: input.sessionId,
      role: input.role,
    };

    const accessToken = signAccessToken(accessClaims);

    const jti = uuid();
    const refreshClaims: Omit<JwtClaims, 'type'> = { ...accessClaims, jti };
    const refreshToken = signRefreshToken(refreshClaims);
    const tokenHash = this.hash(refreshToken);

    const ttlMs = this.parseDurationMs(env.JWT_REFRESH_TTL);
    const expiresAt = new Date(Date.now() + ttlMs);

    const row = await refreshTokenRepository.create({
      userId: input.userId as unknown as Types.ObjectId,
      sessionId: input.sessionId as unknown as Types.ObjectId,
      tokenHash,
      jti,
      issuedAt: new Date(),
      expiresAt,
      revokedAt: null,
      rotatedTo: null,
      reuseDetectedAt: null,
    });

    return {
      accessToken,
      refreshToken,
      accessExpiresIn: env.JWT_ACCESS_TTL,
      refreshExpiresIn: env.JWT_REFRESH_TTL,
      refreshTokenId: row._id,
    };
  }

  /**
   * Verifies + rotates a refresh token.
   *
   * @returns
   *  - `{ kind: 'rotated', pair }` on success,
   *  - `{ kind: 'reuse', userId, sessionId }` if the token was already
   *    rotated → caller MUST revoke the entire session chain,
   *  - `{ kind: 'invalid' }` for unknown / expired / malformed tokens.
   */
  async rotate(
    presentedToken: string,
    role: string,
  ): Promise<
    | { kind: 'rotated'; pair: IssuedTokenPair }
    | { kind: 'reuse'; userId: string; sessionId: string }
    | { kind: 'invalid' }
  > {
    const tokenHash = this.hash(presentedToken);
    const row = await refreshTokenRepository.findByHash(tokenHash);
    if (!row) return { kind: 'invalid' };

    if (row.revokedAt || row.rotatedTo) {
      // Replay of an already-rotated token. Mark + bubble up.
      await refreshTokenRepository.markReuse(row.id);
      return { kind: 'reuse', userId: String(row.userId), sessionId: String(row.sessionId) };
    }
    if (row.expiresAt.getTime() < Date.now()) return { kind: 'invalid' };

    const pair = await this.issuePair({
      userId: String(row.userId),
      sessionId: String(row.sessionId),
      role,
    });

    await refreshTokenRepository.markRotated(row.id, String(pair.refreshTokenId));
    return { kind: 'rotated', pair };
  }
}

export const tokenService = new TokenService();
export { TokenService };

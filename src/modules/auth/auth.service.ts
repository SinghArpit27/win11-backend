import type { Request } from 'express';
import { type Types } from 'mongoose';

import { env } from '@config/env.config';
import { AppConstants } from '@common/constants';
import { ErrorCode } from '@common/constants/error-codes';
import {
  AuditAction,
  AuthProvider,
  ClientPlatform,
  OtpChannel,
  OtpPurpose,
  SessionStatus,
  UserRole,
  UserStatus,
} from '@common/enums';
import {
  AppError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '@common/errors';
import { HttpStatus } from '@common/constants';
import { auditLogger, securityLogger } from '@common/logging';
import { hashPassword, verifyPassword } from '@common/utils/password.util';
import { normalizePhone } from '@common/utils/phone.util';
import { generateGameUsernameSeed, generateUniqueUsername } from '@common/utils/username.util';

import { BaseService } from '@shared/services/base.service';

import { sessionRepository } from '@modules/session/session.repository';
import { userRepository } from '@modules/user/user.repository';
import { walletService } from '@modules/wallet/wallet.service';

import { otpService } from './otp.service';
import { otpDeliveryService } from './otp-delivery.service';
import { tokenService, type IssuedTokenPair } from './token.service';
import type {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  PhoneSendOtpBody,
  PhoneVerifyOtpBody,
  RequestOtpBody,
  ResetPasswordBody,
  SignupBody,
  VerifyEmailBody,
  VerifyOtpBody,
} from './auth.validators';

/**
 * Auth orchestration. The service is intentionally fat-free:
 *  - validates business rules (account locked, account suspended),
 *  - delegates persistence to repositories,
 *  - delegates token + OTP details to dedicated services,
 *  - records audit + security events.
 *
 * Every public method either resolves or throws an `AppError` subclass —
 * controllers are thin async-handlers that delegate to these methods.
 */

const LOCK_THRESHOLD = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

const parseDurationMs = (spec: string): number => {
  const m = /^(\d+)([smhd])$/.exec(spec);
  if (!m) return 30 * 24 * 60 * 60 * 1000;
  const factors: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(m[1]) * (factors[m[2]] ?? 86_400_000);
};

export interface AuthSuccess {
  user: PublicUser;
  tokens: IssuedTokenPair;
  sessionId: string;
}

export interface PublicUser {
  id: string;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  roles: UserRole[];
  status: UserStatus;
}

const toPublicUser = (u: {
  _id: Types.ObjectId | string;
  email?: string | null;
  phone?: string | null;
  emailVerifiedAt?: Date | null;
  phoneVerifiedAt?: Date | null;
  displayName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  roles?: UserRole[];
  status?: UserStatus;
}): PublicUser => ({
  id: String(u._id),
  email: u.email ?? null,
  phone: u.phone ?? null,
  emailVerified: !!u.emailVerifiedAt,
  phoneVerified: !!u.phoneVerifiedAt,
  displayName: u.displayName ?? null,
  username: u.username ?? null,
  avatarUrl: u.avatarUrl ?? null,
  roles: u.roles ?? [UserRole.USER],
  status: u.status ?? UserStatus.PENDING_VERIFICATION,
});

class AuthService extends BaseService {
  constructor() {
    super('auth-service');
  }

  // ───────────────────────────────────────────────────────── Signup ───────
  async signup(input: SignupBody, req: Request): Promise<AuthSuccess> {
    if (input.email && (await userRepository.findByEmail(input.email))) {
      throw new ConflictError('Email already registered', { field: 'email' });
    }
    if (input.phone && (await userRepository.findByPhone(input.phone))) {
      throw new ConflictError('Phone already registered', { field: 'phone' });
    }
    if (input.username && (await userRepository.findByUsername(input.username))) {
      throw new ConflictError('Username already taken', { field: 'username' });
    }

    const passwordHash = await hashPassword(input.password);
    const user = await userRepository.create({
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordHash,
      displayName: input.displayName ?? null,
      username: input.username ?? null,
      roles: [UserRole.USER],
      status: UserStatus.PENDING_VERIFICATION,
    });

    const result = await this.openSession(user.id, [UserRole.USER], req);

    // Idempotently provision the user's wallet. Failure here MUST NOT
    // break signup — wallet provisioning is also idempotent on first
    // wallet read so we degrade gracefully if Mongo is briefly slow.
    try {
      await walletService.ensureWalletForUser(user.id);
      await auditLogger.success({
        actorId: user.id,
        action: AuditAction.WALLET_CREATED,
        resource: 'wallet',
        resourceId: user.id,
        req,
      });
    } catch (err) {
      this.logger.warn({ err, userId: user.id }, 'wallet.provision_deferred');
    }

    await auditLogger.success({
      actorId: user.id,
      action: AuditAction.USER_SIGNUP,
      resource: 'user',
      resourceId: user.id,
      metadata: { hasEmail: !!input.email, hasPhone: !!input.phone },
      req,
    });

    // Kick off email/phone verification OTP — channel inferred from input.
    if (input.email) {
      const issued = await otpService.issue({
        userId: user.id,
        identifier: input.email,
        channel: OtpChannel.EMAIL,
        purpose: OtpPurpose.EMAIL_VERIFY,
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      if (env.NODE_ENV === 'development') {
        this.logger.info(
          { identifier: input.email, purpose: OtpPurpose.EMAIL_VERIFY, code: issued.code },
          'otp.dev_code',
        );
      }
    } else if (input.phone) {
      const issued = await otpService.issue({
        userId: user.id,
        identifier: input.phone,
        channel: OtpChannel.SMS,
        purpose: OtpPurpose.PHONE_VERIFY,
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      if (env.NODE_ENV === 'development') {
        this.logger.info(
          { identifier: input.phone, purpose: OtpPurpose.PHONE_VERIFY, code: issued.code },
          'otp.dev_code',
        );
      }
    }

    return { user: toPublicUser(user), tokens: result.tokens, sessionId: result.sessionId };
  }

  // ────────────────────────────────────────────────────────── Login ───────
  async login(input: LoginBody, req: Request): Promise<AuthSuccess> {
    const user = await userRepository.findByIdentifier(input.identifier, true);

    if (!user || !user.passwordHash) {
      await securityLogger.suspicious({
        reason: 'login_unknown_identifier',
        ip: req.ip,
        metadata: { identifier: input.identifier },
        req,
      });
      throw new UnauthorizedError('Invalid credentials', ErrorCode.INVALID_CREDENTIALS);
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedError('Account suspended', ErrorCode.ACCOUNT_SUSPENDED);
    }
    if (user.status === UserStatus.DELETED) {
      throw new UnauthorizedError('Account disabled', ErrorCode.ACCOUNT_DISABLED);
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedError('Account temporarily locked', ErrorCode.ACCOUNT_LOCKED);
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      const nextAttempt = (user.failedLoginCount ?? 0) + 1;
      const lockedUntil =
        nextAttempt >= LOCK_THRESHOLD ? new Date(Date.now() + LOCK_DURATION_MS) : undefined;
      await userRepository.bumpFailedLogin(user.id, lockedUntil);

      await auditLogger.failure({
        actorId: user.id,
        action: AuditAction.USER_LOGIN_FAILED,
        errorCode: ErrorCode.INVALID_CREDENTIALS,
        metadata: { attempt: nextAttempt, locked: !!lockedUntil },
        req,
      });

      if (lockedUntil) {
        await securityLogger.suspicious({
          reason: 'brute_force_lock',
          actorId: user.id,
          metadata: { attempts: nextAttempt },
          req,
        });
      }

      throw new UnauthorizedError('Invalid credentials', ErrorCode.INVALID_CREDENTIALS);
    }

    await userRepository.resetFailedLogin(user.id, req.ip);

    const result = await this.openSession(user.id, user.roles, req);

    await auditLogger.success({
      actorId: user.id,
      action: AuditAction.USER_LOGIN,
      resource: 'user',
      resourceId: user.id,
      req,
    });

    return { user: toPublicUser(user), tokens: result.tokens, sessionId: result.sessionId };
  }

  // ──────────────────────────────────────────────────────── Refresh ───────
  async refresh(presentedToken: string, req: Request): Promise<IssuedTokenPair> {
    if (!presentedToken) {
      throw new UnauthorizedError('Refresh token required', ErrorCode.REFRESH_TOKEN_INVALID);
    }

    // We need a role to embed in the new access token — pull it from the
    // user lookup that backs the rotation row.
    const rotation = await tokenService.rotate(presentedToken, UserRole.USER);
    if (rotation.kind === 'invalid') {
      throw new UnauthorizedError('Invalid refresh token', ErrorCode.REFRESH_TOKEN_INVALID);
    }
    if (rotation.kind === 'reuse') {
      await sessionRepository.revoke(rotation.sessionId, 'refresh_token_reuse');
      await securityLogger.suspicious({
        reason: 'refresh_token_reuse',
        actorId: rotation.userId,
        metadata: { sessionId: rotation.sessionId },
        req,
      });
      await auditLogger.failure({
        actorId: rotation.userId,
        action: AuditAction.TOKEN_REFRESH_REUSE,
        resource: 'session',
        resourceId: rotation.sessionId,
        errorCode: ErrorCode.REFRESH_TOKEN_REUSED,
        req,
      });
      throw new UnauthorizedError(
        'Refresh token reused — session revoked',
        ErrorCode.REFRESH_TOKEN_REUSED,
      );
    }

    await sessionRepository.touch(String(rotation.pair.refreshTokenId));
    await auditLogger.success({
      action: AuditAction.TOKEN_REFRESHED,
      metadata: { sessionId: rotation.pair.refreshTokenId },
      req,
    });
    return rotation.pair;
  }

  // ───────────────────────────────────────────────────────── Logout ───────
  async logout(userId: string, sessionId: string, req: Request): Promise<void> {
    await sessionRepository.revoke(sessionId, 'user_logout');
    await auditLogger.success({
      actorId: userId,
      action: AuditAction.USER_LOGOUT,
      resource: 'session',
      resourceId: sessionId,
      req,
    });
  }

  async logoutAll(userId: string, req: Request, exceptSessionId?: string): Promise<number> {
    const result = await sessionRepository.revokeAllForUser(
      userId,
      'user_logout_all',
      exceptSessionId,
    );
    await auditLogger.success({
      actorId: userId,
      action: AuditAction.USER_LOGOUT_ALL,
      metadata: { revoked: result.modifiedCount },
      req,
    });
    return result.modifiedCount;
  }

  // ────────────────────────────────────────────────── OTP / Verify ────────
  async requestOtp(input: RequestOtpBody, req: Request): Promise<{ expiresAt: Date }> {
    const user = await userRepository.findByIdentifier(input.identifier);
    const issued = await otpService.issue({
      userId: user?.id ?? null,
      identifier: input.identifier,
      channel: input.channel,
      purpose: input.purpose,
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    if (env.NODE_ENV === 'development') {
      this.logger.info(
        { identifier: input.identifier, purpose: input.purpose, code: issued.code },
        'otp.dev_code',
      );
    }

    await auditLogger.success({
      actorId: user?.id ?? null,
      action: AuditAction.OTP_REQUESTED,
      metadata: { purpose: input.purpose, channel: input.channel },
      req,
    });
    return { expiresAt: issued.expiresAt };
  }

  async verifyOtp(input: VerifyOtpBody, req: Request): Promise<{ verified: true }> {
    try {
      const result = await otpService.verify({
        identifier: input.identifier,
        purpose: input.purpose,
        code: input.code,
      });

      if (result.userId) {
        if (input.purpose === OtpPurpose.EMAIL_VERIFY) {
          await userRepository.markEmailVerified(result.userId);
        } else if (input.purpose === OtpPurpose.PHONE_VERIFY) {
          await userRepository.markPhoneVerified(result.userId);
        }
      }

      await auditLogger.success({
        actorId: result.userId ?? null,
        action: AuditAction.OTP_VERIFIED,
        metadata: { purpose: input.purpose },
        req,
      });
      return { verified: true };
    } catch (err) {
      await auditLogger.failure({
        action: AuditAction.OTP_FAILED,
        errorCode: (err as { errorCode?: string }).errorCode,
        metadata: { purpose: input.purpose },
        req,
      });
      throw err;
    }
  }

  async verifyEmail(input: VerifyEmailBody, req: Request): Promise<PublicUser> {
    await otpService.verify({
      identifier: input.email,
      purpose: OtpPurpose.EMAIL_VERIFY,
      code: input.code,
    });
    const user = await userRepository.findByEmail(input.email);
    if (!user) throw new NotFoundError('User');
    const updated = await userRepository.markEmailVerified(user.id);
    await auditLogger.success({
      actorId: user.id,
      action: AuditAction.EMAIL_VERIFIED,
      req,
    });
    return toPublicUser(updated ?? user);
  }

  // ──────────────────────────────────────────────── Forgot / Reset ────────
  async forgotPassword(input: ForgotPasswordBody, req: Request): Promise<{ accepted: true }> {
    const user = await userRepository.findByIdentifier(input.identifier);
    // Always accept — never leak account existence.
    if (user) {
      await otpService.issue({
        userId: user.id,
        identifier: input.identifier,
        channel: input.identifier.includes('@') ? OtpChannel.EMAIL : OtpChannel.SMS,
        purpose: OtpPurpose.PASSWORD_RESET,
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
    }
    await auditLogger.success({
      actorId: user?.id ?? null,
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      metadata: { identifierHash: maskedIdentifier(input.identifier) },
      req,
    });
    return { accepted: true };
  }

  async resetPassword(input: ResetPasswordBody, req: Request): Promise<{ reset: true }> {
    await otpService.verify({
      identifier: input.identifier,
      purpose: OtpPurpose.PASSWORD_RESET,
      code: input.code,
    });

    const user = await userRepository.findByIdentifier(input.identifier);
    if (!user) throw new NotFoundError('User');

    const passwordHash = await hashPassword(input.newPassword);
    await userRepository.updatePasswordHash(user.id, passwordHash);

    // Reset failed-login counters + revoke all sessions.
    await userRepository.resetFailedLogin(user.id, req.ip);
    await sessionRepository.revokeAllForUser(user.id, 'password_reset');

    await auditLogger.success({
      actorId: user.id,
      action: AuditAction.PASSWORD_RESET_COMPLETED,
      req,
    });
    return { reset: true };
  }

  async changePassword(
    userId: string,
    input: ChangePasswordBody,
    req: Request,
  ): Promise<{ changed: true }> {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User');
    const withHash = await userRepository.findByIdentifier(user.email ?? user.phone ?? '', true);
    if (!withHash?.passwordHash) throw new BadRequestError('Password cannot be changed');

    const ok = await verifyPassword(input.currentPassword, withHash.passwordHash);
    if (!ok) {
      throw new UnauthorizedError('Current password is incorrect', ErrorCode.INVALID_CREDENTIALS);
    }

    const passwordHash = await hashPassword(input.newPassword);
    await userRepository.updatePasswordHash(userId, passwordHash);

    await sessionRepository.revokeAllForUser(userId, 'password_changed');
    await auditLogger.success({
      actorId: userId,
      action: AuditAction.PASSWORD_CHANGED,
      req,
    });
    return { changed: true };
  }

  // ───────────────────────────────────────────── Phone OTP auth ───────────
  async sendPhoneAuthOtp(
    input: PhoneSendOtpBody,
    req: Request,
  ): Promise<{ expiresAt: Date; isExistingUser: boolean }> {
    const phone = normalizePhone(input.phone);
    const user = await userRepository.findByPhone(phone);

    const issued = await otpService.issue({
      userId: user?.id ?? null,
      identifier: phone,
      channel: OtpChannel.SMS,
      purpose: OtpPurpose.PHONE_AUTH,
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    await otpDeliveryService.sendSmsOtp(phone, issued.code);

    await auditLogger.success({
      actorId: user?.id ?? null,
      action: AuditAction.OTP_REQUESTED,
      metadata: { purpose: OtpPurpose.PHONE_AUTH, channel: OtpChannel.SMS },
      req,
    });

    return {
      expiresAt: issued.expiresAt,
      isExistingUser: !!user,
    };
  }

  async verifyPhoneAuthOtp(input: PhoneVerifyOtpBody, req: Request): Promise<AuthSuccess> {
    const phone = normalizePhone(input.phone);
    let user = await userRepository.findByPhone(phone);

    await otpService.verify({
      identifier: phone,
      purpose: OtpPurpose.PHONE_AUTH,
      code: input.code,
    });

    if (user) {
      this.assertAccountCanLogin(user);
      if (!user.phoneVerifiedAt) {
        user = (await userRepository.markPhoneVerified(user.id)) ?? user;
      } else if (user.status === UserStatus.PENDING_VERIFICATION) {
        user = (await userRepository.markPhoneVerified(user.id)) ?? user;
      }
      await userRepository.resetFailedLogin(user.id, req.ip);
    } else {
      const username = await generateUniqueUsername(generateGameUsernameSeed(), async (candidate) => {
        const existing = await userRepository.findByUsername(candidate);
        return !!existing;
      });

      user = await userRepository.create({
        email: null,
        phone,
        passwordHash: null,
        authProvider: AuthProvider.PHONE,
        displayName: null,
        username,
        roles: [UserRole.USER],
        status: UserStatus.ACTIVE,
        phoneVerifiedAt: new Date(),
      });

      try {
        await walletService.ensureWalletForUser(user.id);
      } catch (err) {
        this.logger.warn({ err, userId: user.id }, 'wallet.provision_deferred');
      }

      await auditLogger.success({
        actorId: user.id,
        action: AuditAction.USER_SIGNUP,
        resource: 'user',
        resourceId: user.id,
        metadata: { authProvider: AuthProvider.PHONE },
        req,
      });
    }

    const result = await this.openSession(user.id, user.roles, req);

    await auditLogger.success({
      actorId: user.id,
      action: AuditAction.USER_LOGIN,
      resource: 'user',
      resourceId: user.id,
      metadata: { authProvider: AuthProvider.PHONE },
      req,
    });

    return { user: toPublicUser(user), tokens: result.tokens, sessionId: result.sessionId };
  }

  // ──────────────────────────────────────────────────────── helpers ───────
  private assertAccountCanLogin(
    user: {
      status?: UserStatus;
      lockedUntil?: Date | null;
    },
  ): void {
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedError('Account suspended', ErrorCode.ACCOUNT_SUSPENDED);
    }
    if (user.status === UserStatus.DELETED) {
      throw new UnauthorizedError('Account disabled', ErrorCode.ACCOUNT_DISABLED);
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedError('Account temporarily locked', ErrorCode.ACCOUNT_LOCKED);
    }
  }

  private async openSession(
    userId: string,
    roles: UserRole[],
    req: Request,
  ): Promise<{ tokens: IssuedTokenPair; sessionId: string }> {
    const ttlMs = parseDurationMs(process.env.JWT_REFRESH_TTL ?? '30d');
    const session = await sessionRepository.create({
      userId: userId as unknown as Types.ObjectId,
      status: SessionStatus.ACTIVE,
      deviceId: req.header(AppConstants.DEVICE_ID_HEADER) ?? null,
      platform:
        (req.header(AppConstants.CLIENT_PLATFORM_HEADER) as ClientPlatform | undefined) ??
        ClientPlatform.WEB,
      appVersion: req.header(AppConstants.CLIENT_VERSION_HEADER) ?? null,
      userAgent: req.header('user-agent') ?? null,
      ip: req.ip ?? null,
      ipCountry: null,
      issuedAt: new Date(),
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      revokedAt: null,
      revokedReason: null,
    });

    const tokens = await tokenService.issuePair({
      userId,
      sessionId: session.id,
      role: roles[0] ?? UserRole.USER,
      roles,
    });

    return { tokens, sessionId: session.id };
  }
}

const maskedIdentifier = (id: string): string => {
  if (!id) return '';
  if (id.includes('@')) {
    const [u, d] = id.split('@');
    return `${u.slice(0, 2)}***@${d}`;
  }
  return `${id.slice(0, 3)}****${id.slice(-2)}`;
};

export const authService = new AuthService();
export { AuthService, toPublicUser };

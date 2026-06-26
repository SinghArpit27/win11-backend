import crypto from 'node:crypto';

import { type Types } from 'mongoose';

import { env, isProduction } from '@config/env.config';

import { AppConstants } from '@common/constants';
import { ErrorCode } from '@common/constants/error-codes';
import { OtpChannel, OtpPurpose } from '@common/enums';
import { BadRequestError, UnauthorizedError } from '@common/errors';

import { BaseService } from '@shared/services/base.service';

import { authOtpRepository } from './auth-otp.repository';

/**
 * OTP service — generates, persists (hashed), verifies and consumes
 * one-time codes. The actual delivery channel (SES / SNS / Twilio) is
 * deferred to the queue layer; PHASE 2 logs the code in dev and exposes
 * it via a queue payload (the queue handler lands in Phase 8).
 */
class OtpService extends BaseService {
  constructor() {
    super('otp-service');
  }

  private generateCode(): string {
    const devCode = env.OTP_DEV_CODE?.trim();
    if (!isProduction && devCode) {
      return devCode;
    }

    // 6-digit numeric code, leading zeros preserved.
    const n = crypto.randomInt(0, 1_000_000);
    return n.toString().padStart(AppConstants.OTP.LENGTH, '0');
  }

  private hash(code: string, identifier: string): string {
    return crypto
      .createHash('sha256')
      .update(`${code}|${identifier.toLowerCase()}`)
      .digest('hex');
  }

  /**
   * Create + persist an OTP. Returns the plain code so the caller (queue
   * handler / email transport) can deliver it. Storing the code anywhere
   * outside this method is a violation.
   */
  async issue(input: {
    userId?: string | null;
    identifier: string;
    channel: OtpChannel;
    purpose: OtpPurpose;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<{ code: string; expiresAt: Date }> {
    // Throttle bursts at the model level (rate limiter is the first line).
    const recent = await authOtpRepository.recentRequestCount(
      input.identifier,
      input.purpose,
      60_000,
    );
    if (recent >= 1) {
      throw new BadRequestError('Please wait a moment before requesting another code');
    }

    await authOtpRepository.invalidateActive(
      input.identifier,
      input.purpose,
      input.channel,
    );

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + AppConstants.OTP.TTL_SECONDS * 1000);

    await authOtpRepository.create({
      userId: (input.userId ?? null) as unknown as Types.ObjectId | null,
      identifier: input.identifier.toLowerCase(),
      channel: input.channel,
      purpose: input.purpose,
      codeHash: this.hash(code, input.identifier),
      attemptsRemaining: AppConstants.OTP.MAX_ATTEMPTS,
      consumedAt: null,
      expiresAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });

    this.logger.info(
      {
        identifier: input.identifier,
        purpose: input.purpose,
        channel: input.channel,
        expiresAt,
      },
      'otp.issued',
    );

    return { code, expiresAt };
  }

  /**
   * Verify + consume on success. Decrements attempt counter on failure
   * and locks the OTP once exhausted.
   */
  async verify(input: {
    identifier: string;
    purpose: OtpPurpose;
    code: string;
  }): Promise<{ otpId: string; userId: string | null }> {
    const otp = await authOtpRepository.findActive(input.identifier, input.purpose);
    if (!otp) {
      throw new UnauthorizedError('Invalid or expired code', ErrorCode.OTP_INVALID);
    }
    if (otp.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError('Code expired', ErrorCode.OTP_EXPIRED);
    }
    if (otp.attemptsRemaining <= 0) {
      throw new UnauthorizedError('Too many attempts', ErrorCode.OTP_MAX_ATTEMPTS);
    }

    const expectedHash = this.hash(input.code, input.identifier);
    const matches =
      otp.codeHash &&
      crypto.timingSafeEqual(Buffer.from(otp.codeHash), Buffer.from(expectedHash));

    if (!matches) {
      const updated = await authOtpRepository.decrementAttempts(otp.id);
      if ((updated?.attemptsRemaining ?? 0) <= 0) {
        throw new UnauthorizedError('Too many attempts', ErrorCode.OTP_MAX_ATTEMPTS);
      }
      throw new UnauthorizedError('Invalid code', ErrorCode.OTP_INVALID);
    }

    await authOtpRepository.consume(otp.id);
    return { otpId: otp.id, userId: otp.userId ? String(otp.userId) : null };
  }
}

export const otpService = new OtpService();
export { OtpService };

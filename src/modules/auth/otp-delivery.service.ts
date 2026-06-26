import { env, isDevelopment, isProduction } from '@config/env.config';
import { AppConstants } from '@common/constants';

import { BaseService } from '@shared/services/base.service';

import { phoneDigitsForSms } from '@common/utils/phone.util';

/**
 * Delivers OTP codes over SMS.
 *
 * Providers:
 *  - `console` (default) — logs only; free for dev/staging.
 *  - `fast2sms` — Fast2SMS India OTP route (free trial credits on signup).
 *
 * Configure via `OTP_PROVIDER` and `FAST2SMS_API_KEY` in `.env`.
 */
class OtpDeliveryService extends BaseService {
  constructor() {
    super('otp-delivery');
  }

  async sendSmsOtp(phone: string, code: string): Promise<void> {
    const message = `Your ${env.APP_NAME} verification code is ${code}. Valid for ${Math.floor(AppConstants.OTP.TTL_SECONDS / 60)} minutes.`;

    switch (env.OTP_PROVIDER) {
      case 'fast2sms':
        await this.sendViaFast2Sms(phone, code, message);
        return;
      case 'console':
      default:
        if (isDevelopment) {
          this.logger.info({ phone }, 'otp.sms.console_skipped');
        }
    }
  }

  private async sendViaFast2Sms(phone: string, code: string, message: string): Promise<void> {
    const apiKey = env.FAST2SMS_API_KEY?.trim();
    if (!apiKey) {
      this.logger.warn('FAST2SMS_API_KEY missing — falling back to console OTP log');
      this.logger.info({ phone, code, message }, 'otp.sms.console');
      return;
    }

    const numbers = phoneDigitsForSms(phone).replace(/^91/, '');
    const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        route: 'otp',
        variables_values: code,
        numbers,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error({ status: response.status, body }, 'otp.sms.fast2sms_failed');
      if (isDevelopment) {
        this.logger.info({ phone, code, message }, 'otp.sms.console_fallback');
        return;
      }
      throw new Error('Failed to send SMS OTP');
    }
  }
}

export const otpDeliveryService = new OtpDeliveryService();

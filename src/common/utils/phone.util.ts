/**
 * Normalise phone numbers to E.164 for storage and OTP delivery.
 * Defaults to India (+91) when a 10-digit local number is supplied.
 */
export const normalizePhone = (input: string, defaultCountryCode = '91'): string => {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;

  if (trimmed.startsWith('+')) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+${defaultCountryCode}${digits}`;
  }

  if (digits.length === 12 && digits.startsWith(defaultCountryCode)) {
    return `+${digits}`;
  }

  return `+${digits}`;
};

/** Strip + prefix for SMS providers that expect local digits only. */
export const phoneDigitsForSms = (e164: string): string => e164.replace(/\D/g, '');

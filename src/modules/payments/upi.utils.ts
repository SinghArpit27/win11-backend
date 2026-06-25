import { randomUUID } from 'node:crypto';

/** Supported UPI app identifiers from the Win11 deposit UI. */
export const UPI_APPS = ['google_pay', 'phonepe', 'paytm', 'bhim', 'other'] as const;
export type UpiAppId = (typeof UPI_APPS)[number];

export const isUpiAppId = (value: string): value is UpiAppId =>
  (UPI_APPS as readonly string[]).includes(value);

const APP_LABELS: Record<UpiAppId, string> = {
  google_pay: 'Google Pay',
  phonepe: 'PhonePe',
  paytm: 'Paytm',
  bhim: 'BHIM',
  other: 'Other UPI',
};

export const upiAppLabel = (app: UpiAppId): string => APP_LABELS[app];

/**
 * Build a UPI deep link that opens the selected app on mobile.
 * Uses standard `upi://` scheme; PhonePe/Paytm also get app-specific schemes.
 */
export const buildUpiDeepLink = (args: {
  app: UpiAppId;
  vpa: string;
  amountMinor: number;
  merchantName: string;
  transactionRef: string;
}): string => {
  const params = new URLSearchParams({
    pa: args.vpa,
    pn: args.merchantName,
    am: (args.amountMinor / 100).toFixed(2),
    cu: 'INR',
    tn: args.transactionRef,
    tr: args.transactionRef,
  });
  const query = params.toString();

  switch (args.app) {
    case 'phonepe':
      return `phonepe://pay?${query}`;
    case 'paytm':
      return `paytmmp://pay?${query}`;
    case 'google_pay':
      return `tez://upi/pay?${query}`;
    default:
      return `upi://pay?${query}`;
  }
};

export const createUpiSimOrderId = (): string => `upi_sim_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

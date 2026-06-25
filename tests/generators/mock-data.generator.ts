import { randomUUID } from 'node:crypto';

/** Generates unique, RFC-safe test emails. */
export const uniqueEmail = (prefix = 'user'): string =>
  `${prefix}-${randomUUID().slice(0, 8)}@win11.test`;

/** Generates E.164 test phone numbers (+919XXXXXXXXX). */
export const uniquePhone = (): string => {
  const suffix = Math.floor(1_000_000_000 + Math.random() * 9_000_000_000);
  return `+91${String(suffix).slice(0, 10)}`;
};

export const uniqueUsername = (prefix = 'player'): string =>
  `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`.slice(0, 20);

export const uniqueIdempotencyKey = (): string => `idem-${randomUUID()}`;

export const futureDate = (daysFromNow = 7): Date => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d;
};

export const pastDate = (daysAgo = 7): Date => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
};

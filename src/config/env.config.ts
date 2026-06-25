import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Centralised, validated runtime configuration.
 *
 * - Loads `.env` once at startup.
 * - Validates every variable with Zod.
 * - Fails fast on invalid configuration (no silent fallbacks).
 * - Exposes a single typed `env` object — never read `process.env` elsewhere.
 */

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Parse `.env` booleans correctly. `z.coerce.boolean()` treats the string
 * `"false"` as true (non-empty string), which breaks flags like
 * `REDIS_ENABLED=false`.
 */
const envBoolean = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return defaultValue;
      if (typeof val === 'boolean') return val;
      if (typeof val === 'number') return val !== 0;
      const lower = String(val).toLowerCase().trim();
      if (['true', '1', 'yes', 'on'].includes(lower)) return true;
      if (['false', '0', 'no', 'off'].includes(lower)) return false;
      return defaultValue;
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  APP_NAME: z.string().default('Win11'),
  APP_SLUG: z
    .string()
    .regex(/^[a-z0-9-]+$/i, 'APP_SLUG must be url-safe (a-z, 0-9, -)')
    .default('win11'),
  APP_TAGLINE: z.string().default('Fantasy Sports — Reimagined'),
  APP_LOGO_URL: z.string().default(''),
  APP_THEME: z.string().default('dark-fantasy'),
  APP_DEFAULT_CURRENCY: z
    .string()
    .length(3, 'Currency must be a 3-letter ISO 4217 code')
    .default('INR'),
  APP_DEFAULT_LOCALE: z.string().default('en-IN'),
  APP_VERSION: z.string().default('0.1.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api/v1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  CORS_ORIGIN: z.string().default('*'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  MONGO_MIN_POOL: z.coerce.number().int().positive().default(5),
  MONGO_MAX_POOL: z.coerce.number().int().positive().default(50),

  // Either supply a single REDIS_URL (recommended for managed Redis like
  // Upstash / Redis Cloud — `rediss://` enables TLS automatically), OR set
  // REDIS_HOST / REDIS_PORT / REDIS_PASSWORD individually. For managed
  // providers with discrete vars, also set REDIS_TLS=true.
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_USERNAME: z.string().optional().default(''),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  REDIS_TLS: envBoolean(false),
  REDIS_KEY_PREFIX: z.string().default('win11:'),
  /**
   * When `false`, Redis + BullMQ are skipped at boot (development only).
   * Caching, leaderboards, and background jobs degrade gracefully — Mongo
   * remains the source of truth. Useful when a managed Redis quota (e.g.
   * Upstash free tier) is exhausted during local dev.
   */
  REDIS_ENABLED: envBoolean(true),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  JWT_ISSUER: z.string().default('win11'),
  JWT_AUDIENCE: z.string().default('win11-mobile'),

  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  BULLMQ_PREFIX: z.string().default('win11:bull'),

  SOCKET_PATH: z.string().default('/socket.io'),
  SOCKET_PING_INTERVAL: z.coerce.number().int().positive().default(20_000),
  SOCKET_PING_TIMEOUT: z.coerce.number().int().positive().default(25_000),

  ENABLE_SWAGGER: envBoolean(true),
  ENABLE_REQUEST_LOGS: envBoolean(true),

  /**
   * CricketData.org (cricapi) — free open API for cricket squads,
   * matches, and player stats.
   *
   *  Get your key (free, no credit card) at:
   *    https://cricketdata.org/signup.aspx
   *
   *  Free tier: 100 hits / day. Leave `CRIC_API_KEY` empty to disable
   *  the provider and fall back to the seeded mock catalogue — the app
   *  remains fully usable without an external API key.
   */
  CRIC_API_KEY: z.string().optional().default(''),
  CRIC_API_BASE_URL: z.string().url().default('https://api.cricapi.com/v1'),
  CRIC_API_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  /**
   * Optional comma-separated list of cricapi series IDs to ingest on
   * boot / cron. When empty, the provider falls back to "current
   * matches" only so the free 100/day quota lasts.
   */
  CRIC_API_SERIES_IDS: z.string().optional().default(''),

  /** PHASE 9 — Payment gateway configuration. */
  PAYMENT_PROVIDER: z.enum(['stripe', 'razorpay', 'mock']).default('mock'),
  STRIPE_PUBLISHABLE_KEY: z.string().optional().default(''),
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  /** Enable UPI on INR Checkout (Google Pay, PhonePe, Paytm via UPI). Requires UPI enabled in Stripe Dashboard. */
  STRIPE_ENABLE_UPI: envBoolean(true),
  /** Use in-app UPI simulator instead of Stripe Checkout UPI form (recommended for dev/testing). */
  STRIPE_UPI_SIMULATOR: envBoolean(true),
  /** Merchant UPI VPA for real UPI deep links when simulator is off (e.g. merchant@paytm). */
  STRIPE_UPI_VPA: z.string().optional().default(''),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
  /** Allow direct manual deposit API (dev/test only). Production uses webhooks. */
  MANUAL_DEPOSIT_ENABLED: envBoolean(false),
});

export type EnvConfig = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed. Aborting startup.');
}

export const env: EnvConfig = Object.freeze(parsed.data);

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/**
 * Centralised branding / app-identity facade.
 *
 * All "what is this application called?" reads MUST come from here so the
 * platform stays white-label ready. NEVER inline "Win11" anywhere in code.
 */
export const appIdentity = Object.freeze({
  name: env.APP_NAME,
  slug: env.APP_SLUG,
  tagline: env.APP_TAGLINE,
  logoUrl: env.APP_LOGO_URL || null,
  theme: env.APP_THEME,
  defaultCurrency: env.APP_DEFAULT_CURRENCY.toUpperCase(),
  defaultLocale: env.APP_DEFAULT_LOCALE,
  version: env.APP_VERSION,
});

export type AppIdentity = typeof appIdentity;

/**
 * Application-wide constants. Add new constants here instead of using magic values.
 */
export const AppConstants = {
  REQUEST_ID_HEADER: 'x-request-id',
  CORRELATION_ID_HEADER: 'x-correlation-id',
  IDEMPOTENCY_KEY_HEADER: 'idempotency-key',
  CLIENT_VERSION_HEADER: 'x-client-version',
  CLIENT_PLATFORM_HEADER: 'x-client-platform',
  DEVICE_ID_HEADER: 'x-device-id',

  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,

  CACHE_TTL: {
    SHORT: 30,
    MEDIUM: 60 * 5,
    LONG: 60 * 60,
    DAY: 60 * 60 * 24,
  },

  PASSWORD: {
    MIN_LENGTH: 8,
    MAX_LENGTH: 128,
    BCRYPT_ROUNDS: 12,
  },

  OTP: {
    LENGTH: 6,
    TTL_SECONDS: 300,
    MAX_ATTEMPTS: 5,
  },

  /**
   * Money / wallet constants.
   *
   * `MINOR_UNITS_PER_MAJOR = 100` means we store every amount in the
   * smallest unit of the currency (paise for INR, cents for USD).
   * Storing integers eliminates floating-point drift inside the ledger.
   */
  MONEY: {
    MINOR_UNITS_PER_MAJOR: 100,
    DEPOSIT_MIN_MAJOR: 10,
    DEPOSIT_MAX_MAJOR: 100_000,
    WITHDRAW_MIN_MAJOR: 100,
    WITHDRAW_MAX_MAJOR: 50_000,
    DAILY_DEPOSIT_LIMIT_MAJOR: 200_000,
  },

  /**
   * BullMQ retry/backoff defaults for wallet-related jobs (payout
   * webhook processing, reconciliation sweeps). Picked conservatively
   * so a transient gateway flake doesn't escalate to a stuck queue.
   */
  WALLET_JOB: {
    MAX_ATTEMPTS: 5,
    BACKOFF_MS: 30_000,
    LOCK_DURATION_MS: 60_000,
  },

  /**
   * PHASE 4 — Sports ingestion + cache defaults.
   *
   * Cache TTLs are kept short for hot reads (live scores) and longer
   * for cold reads (player profiles). All in seconds.
   *
   * Sync intervals are advisory — the actual queue scheduler may run
   * faster (live scores during business hours) or slower (player roster
   * once a day).
   */
  SPORTS: {
    CACHE_TTL: {
      LIVE_MATCH: 10,
      UPCOMING_MATCHES: 60,
      FEATURED_MATCHES: 120,
      TRENDING_MATCHES: 120,
      MATCH_DETAIL: 30,
      PLAYER_PROFILE: 600,
      PLAYER_STATS: 300,
      TEAM_PROFILE: 600,
      TOURNAMENT_LIST: 600,
    },
    SYNC_INTERVAL_MS: {
      MATCH_LIST: 5 * 60_000,
      LIVE_SCORE: 10_000,
      PLAYER_ROSTER: 24 * 60 * 60_000,
      CACHE_REFRESH: 60_000,
    },
    SYNC_JOB: {
      MAX_ATTEMPTS: 3,
      BACKOFF_MS: 15_000,
      LOCK_DURATION_MS: 120_000,
    },
    FEATURED_MAX: 12,
    TRENDING_MAX: 12,
    UPCOMING_WINDOW_DAYS: 14,
    DEFAULT_TIMEZONE: 'Asia/Kolkata',
  },

  /**
   * PHASE 5 — Fantasy team defaults.
   *
   * These are *fallbacks* only — runtime values come from the
   * `fantasy_rules` collection so admins can tune per sport+format.
   * Constants here exist so the validator can degrade gracefully when
   * an admin has not yet configured a rule set.
   */
  FANTASY: {
    DEFAULT_TEAM_SIZE: 11,
    DEFAULT_CREDIT_BUDGET: 100,
    DEFAULT_MAX_FROM_SINGLE_TEAM: 7,
    DEFAULT_MIN_FROM_SINGLE_TEAM: 4,
    DEFAULT_MAX_TEAMS_PER_USER_PER_MATCH: 20,
    DEFAULT_CAPTAIN_MULTIPLIER: 2,
    DEFAULT_VICE_CAPTAIN_MULTIPLIER: 1.5,
    DEFAULT_PLAYER_BASE_CREDITS: 8,
    /** Drafts auto-purged this many seconds after `lastEditedAt`. */
    DRAFT_TTL_SECONDS: 7 * 24 * 60 * 60,
    /** Maximum allowed teams in a single user clone-storm — used by the
     *  service to short-circuit before hitting the DB. */
    CLONE_HARD_CAP: 50,
    CACHE_TTL: {
      ACTIVE_RULE: 600,
      ACTIVE_SCORING_RULE: 600,
      USER_TEAMS: 30,
    },
    TEAM_NAME: {
      MIN_LENGTH: 1,
      MAX_LENGTH: 40,
    },
  },

  /**
   * PHASE 6 — Contest defaults.
   *
   * All money values are in MINOR units (paise / cents) — same convention
   * as the wallet ledger so no conversion happens inside the contest
   * service. The frontend formats for display.
   *
   * `MAX_ENTRIES_PER_USER_DEFAULT` is the platform-wide default cap on
   * how many entries one user can have in a single contest; admins can
   * override it per-contest. `INVITE_CODE_LENGTH` is the length of the
   * generated alphanumeric code for PRIVATE contests.
   */
  CONTEST: {
    /** Default join window — when contests open relative to match start. */
    DEFAULT_JOIN_OPENS_HOURS_BEFORE_MATCH: 48,
    /** Default cap on entries per user per contest. */
    MAX_ENTRIES_PER_USER_DEFAULT: 1,
    /** Hard ceiling — admins cannot exceed this even via overrides. */
    MAX_ENTRIES_PER_USER_HARD_CAP: 20,
    /** Hard ceiling on a single contest's spot count. */
    MAX_TOTAL_SPOTS: 1_000_000,
    /** Minimum / maximum entry fee (major units). */
    ENTRY_FEE_MIN_MAJOR: 0,
    ENTRY_FEE_MAX_MAJOR: 100_000,
    /** Prize pool guards (major units). */
    PRIZE_POOL_MIN_MAJOR: 0,
    PRIZE_POOL_MAX_MAJOR: 100_000_000,
    /** Invite code generation. */
    INVITE_CODE_LENGTH: 6,
    INVITE_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // ambiguous chars stripped
    /** Default share of contest fees collected as platform commission (basis points). */
    DEFAULT_COMMISSION_BPS: 1500,
    /** Cache TTLs (seconds). */
    CACHE_TTL: {
      LIST: 30,
      DETAIL: 60,
      PARTICIPANT_COUNT: 10,
      TEMPLATE: 600,
      PRIZE_DISTRIBUTION: 600,
    },
    NAME: {
      MIN_LENGTH: 3,
      MAX_LENGTH: 80,
    },
    /** How many entries the My Contests screen pages in by default. */
    MY_CONTESTS_PAGE_SIZE: 20,
  },

  /**
   * PHASE 7 — Scoring engine defaults.
   *
   * The engine itself is fully driven by the active `fantasy_scoring_rules`
   * row + per-match `player_stats`. These constants govern *how often* the
   * engine runs, how aggressively it caches, and how it degrades when an
   * upstream input is missing.
   *
   * `BATCH_SIZE` is the page size we use when iterating fantasy teams for
   * a match — picked to keep one recompute under ~250ms even with 50k
   * teams. `LIVE_TICK_DEBOUNCE_MS` coalesces bursty live-score updates
   * into a single recompute.
   */
  SCORING: {
    /** Iteration page size when recomputing all teams in a match. */
    BATCH_SIZE: 500,
    /** Don't recompute more often than this for the same match. */
    LIVE_TICK_DEBOUNCE_MS: 7_500,
    /** Hard ceiling so a buggy recompute can't loop forever. */
    MAX_RECOMPUTE_MS: 60_000,
    /** Retry policy for the SCORING_RECOMPUTE queue. */
    JOB: {
      MAX_ATTEMPTS: 3,
      BACKOFF_MS: 5_000,
      LOCK_DURATION_MS: 90_000,
    },
    CACHE_TTL: {
      MATCH_POINTS: 15,
      TEAM_POINTS: 15,
      USER_TOTAL_POINTS: 60,
    },
  },

  /**
   * PHASE 7 — Leaderboard + ranking defaults.
   *
   * Rankings live in Redis sorted sets — these are the knobs around
   * pagination, snapshot frequency, and Mongo fallback.
   *
   * `SCORE_PRECISION` controls how many decimal places we preserve when
   * we shift fantasy points into the integer score that Redis sorted
   * sets need. We use *2* so a 2-decimal `12.50` becomes `1250`.
   */
  LEADERBOARD: {
    /** Decimal places to preserve inside the Redis ZSET score. */
    SCORE_PRECISION: 2,
    /** Default page size for `GET /leaderboard/contests/:id`. */
    DEFAULT_PAGE_SIZE: 25,
    /** Hard ceiling on a single page. */
    MAX_PAGE_SIZE: 100,
    /** Top-N is pre-rendered on every snapshot. */
    TOP_N_PREVIEW: 3,
    /** Snapshot generation cadence (live matches). */
    SNAPSHOT_INTERVAL_MS: 30_000,
    /** Retry policy for LEADERBOARD_REFRESH queue. */
    JOB: {
      MAX_ATTEMPTS: 3,
      BACKOFF_MS: 3_000,
      LOCK_DURATION_MS: 60_000,
    },
    CACHE_TTL: {
      CONTEST_PAGE: 15,
      USER_RANK: 30,
      TOP_N: 15,
      RANK_HISTORY: 120,
    },
    /** Page size on My Rankings screen. */
    MY_RANKINGS_PAGE_SIZE: 20,
  },

  /**
   * PHASE 7 — Settlement defaults.
   *
   * Settlement is the last step in the contest lifecycle — once a match
   * is COMPLETED + final scoring is in, we rank entries, allocate prizes,
   * credit wallets, and flip every entry to SETTLED.
   */
  SETTLEMENT: {
    /** How many entries to settle in one DB transaction. */
    BATCH_SIZE: 200,
    /** Settlement worker concurrency — protect Mongo + wallet. */
    WORKER_CONCURRENCY: 2,
    /** Retry policy. */
    JOB: {
      MAX_ATTEMPTS: 3,
      BACKOFF_MS: 10_000,
      LOCK_DURATION_MS: 5 * 60_000,
    },
    /** Auto-trigger settlement this many ms after match COMPLETED. */
    AUTO_TRIGGER_DELAY_MS: 60_000,
  },
} as const;

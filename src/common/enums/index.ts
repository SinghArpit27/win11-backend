/**
 * Application enums. Use these instead of raw string literals.
 * Many of these are reserved for later phases — declared here up-front so
 * cross-module typing stays consistent as features land.
 */

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
  SUPPORT_AGENT = 'SUPPORT_AGENT',
}

/** Functional buckets used by FE route guards + BE policy checks. */
export const ADMIN_ROLES: ReadonlyArray<UserRole> = [
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.SUPPORT_AGENT,
] as const;

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}

export enum AuthProvider {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  GOOGLE = 'GOOGLE',
  APPLE = 'APPLE',
}

export enum ClientPlatform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
  WEB = 'WEB',
}

export enum TokenType {
  ACCESS = 'ACCESS',
  REFRESH = 'REFRESH',
  OTP = 'OTP',
  EMAIL_VERIFY = 'EMAIL_VERIFY',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

/**
 * Wallet transaction types — the catalogue of business operations that
 * can move money in or out of a user's wallet. Each value maps 1:N to
 * `TransactionLedger` rows via the `WalletService`.
 *
 * NEVER rename a value here. Production audit data references these
 * strings — only add new ones.
 */
export enum WalletTxType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAW = 'WITHDRAW',
  WITHDRAWAL_LOCK = 'WITHDRAWAL_LOCK',
  WITHDRAWAL_RELEASE = 'WITHDRAWAL_RELEASE',
  CONTEST_JOIN = 'CONTEST_JOIN',
  CONTEST_REFUND = 'CONTEST_REFUND',
  WINNING_CREDIT = 'WINNING_CREDIT',
  BONUS_CREDIT = 'BONUS_CREDIT',
  ADMIN_ADJUSTMENT = 'ADMIN_ADJUSTMENT',
}

export enum WalletTxStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}

/**
 * Wallet "balance buckets". Money lives in one of these four buckets
 * and EVERY ledger entry references exactly one bucket. Total spendable
 * balance = deposit + winning + bonus; `LOCKED` is money already
 * committed to a contest (held until settlement).
 */
export enum WalletBucket {
  DEPOSIT = 'DEPOSIT',
  WINNING = 'WINNING',
  BONUS = 'BONUS',
  LOCKED = 'LOCKED',
}

export enum LedgerDirection {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export enum WalletStatus {
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
  CLOSED = 'CLOSED',
}

/**
 * Payment provider catalogue. Phase 3 ships the data model + a manual
 * DEPOSIT entry-point; real gateway integrations (Razorpay/Stripe/etc.)
 * land in a later phase.
 */
export enum PaymentProvider {
  MANUAL = 'MANUAL',
  RAZORPAY = 'RAZORPAY',
  CASHFREE = 'CASHFREE',
  PAYU = 'PAYU',
  STRIPE = 'STRIPE',
  UPI = 'UPI',
}

export enum PaymentAttemptStatus {
  INITIATED = 'INITIATED',
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

/** PHASE 9 — canonical payment record status (`payments` collection). */
export enum PaymentStatus {
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

/** PHASE 9 — withdrawal request lifecycle. */
export enum WithdrawalStatus {
  PENDING = 'PENDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** PHASE 9 — KYC profile status. */
export enum KycStatus {
  PENDING = 'PENDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** PHASE 9 — KYC document types. */
export enum KycDocumentType {
  PAN = 'PAN',
  AADHAAR = 'AADHAAR',
  BANK_PROOF = 'BANK_PROOF',
}

/** PHASE 9 — financial settlement queue types. */
export enum FinancialSettlementType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  REFUND = 'REFUND',
}

export enum FinancialSettlementStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DEAD_LETTER = 'DEAD_LETTER',
}

/** PHASE 9 — fraud / risk flag types. */
export enum RiskFlagType {
  DUPLICATE_PAYMENT = 'DUPLICATE_PAYMENT',
  DUPLICATE_WITHDRAWAL = 'DUPLICATE_WITHDRAWAL',
  VELOCITY = 'VELOCITY',
  SUSPICIOUS_AMOUNT = 'SUSPICIOUS_AMOUNT',
  MULTIPLE_REQUESTS = 'MULTIPLE_REQUESTS',
}

export enum RiskFlagStatus {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
  DISMISSED = 'DISMISSED',
}

/** PHASE 9 — immutable financial audit actions. */
export enum TransactionAuditAction {
  PAYMENT_CREATED = 'PAYMENT_CREATED',
  PAYMENT_CAPTURED = 'PAYMENT_CAPTURED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  WEBHOOK_RECEIVED = 'WEBHOOK_RECEIVED',
  WEBHOOK_VERIFIED = 'WEBHOOK_VERIFIED',
  WEBHOOK_REJECTED = 'WEBHOOK_REJECTED',
  WITHDRAWAL_REQUESTED = 'WITHDRAWAL_REQUESTED',
  WITHDRAWAL_APPROVED = 'WITHDRAWAL_APPROVED',
  WITHDRAWAL_REJECTED = 'WITHDRAWAL_REJECTED',
  WITHDRAWAL_COMPLETED = 'WITHDRAWAL_COMPLETED',
  SETTLEMENT_STARTED = 'SETTLEMENT_STARTED',
  SETTLEMENT_COMPLETED = 'SETTLEMENT_COMPLETED',
  SETTLEMENT_FAILED = 'SETTLEMENT_FAILED',
  KYC_SUBMITTED = 'KYC_SUBMITTED',
  KYC_APPROVED = 'KYC_APPROVED',
  KYC_REJECTED = 'KYC_REJECTED',
  RISK_FLAG_RAISED = 'RISK_FLAG_RAISED',
}

export enum AdminWalletActionType {
  ADJUSTMENT_CREDIT = 'ADJUSTMENT_CREDIT',
  ADJUSTMENT_DEBIT = 'ADJUSTMENT_DEBIT',
  FREEZE = 'FREEZE',
  UNFREEZE = 'UNFREEZE',
  REFUND = 'REFUND',
}

/**
 * Lifecycle of a single contest row.
 *
 *   DRAFT      → admin authoring; not visible to users.
 *   SCHEDULED  → published but not yet open for joins (e.g. a contest
 *                whose `joinOpensAt` is in the future).
 *   OPEN       → accepting entries, has free spots.
 *   FULL       → `totalSpots == filledSpots` but match still hasn't locked
 *                (we keep this distinct so the UI can render a clear
 *                "Contest Full" state without re-querying).
 *   LOCKED     → match `lineupLockedAt` has passed; new joins refused
 *                even if the contest never reached FULL.
 *   LIVE       → match is in progress (set by match-status watcher in a
 *                later phase; today wired through admin / status sync).
 *   COMPLETED  → contest settled (payouts distributed in a later phase).
 *   CANCELLED  → admin-cancelled or auto-cancelled (e.g. match abandoned);
 *                all entries refunded.
 *
 * NEVER rename a value here. Production audit data references these
 * strings — only add new ones.
 */
export enum ContestStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  OPEN = 'OPEN',
  FULL = 'FULL',
  LOCKED = 'LOCKED',
  LIVE = 'LIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum MatchStatus {
  UPCOMING = 'UPCOMING',
  LIVE = 'LIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  ABANDONED = 'ABANDONED',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/**
 * BullMQ queue names. Must NOT contain `:` — BullMQ uses `:` internally as
 * its keyspace separator. Cluster / multi-app isolation is handled by the
 * `BULLMQ_PREFIX` env var instead (default `win11:bull`).
 */
export enum QueueName {
  EMAIL = 'email',
  NOTIFICATION = 'notification',
  WALLET_PAYOUT = 'wallet-payout',
  WALLET_RECONCILE = 'wallet-reconcile',
  CONTEST_SETTLEMENT = 'contest-settlement',
  LEADERBOARD_REFRESH = 'leaderboard-refresh',
  /** PHASE 7 — recompute fantasy points for a match. */
  SCORING_RECOMPUTE = 'scoring-recompute',
  /** PHASE 7 — periodic snapshot of leaderboards for history tracking. */
  LEADERBOARD_SNAPSHOT = 'leaderboard-snapshot',

  // PHASE 4 — Sports ingestion
  /** Refreshes match catalogue (upcoming + completed). */
  MATCH_SYNC = 'match-sync',
  /** High-frequency live score / status updates. */
  LIVE_SCORE_SYNC = 'live-score-sync',
  /** Daily team + player roster refresh. */
  PLAYER_SYNC = 'player-sync',
  /** Background refresh of hot cache keys (featured / trending). */
  SPORTS_CACHE_REFRESH = 'sports-cache-refresh',
  /** PHASE 8 — fan-out domain events to Redis pub/sub + Socket.io. */
  REALTIME_DISPATCH = 'realtime-dispatch',
  /** PHASE 9 — financial settlement workers. */
  DEPOSIT_SETTLEMENT = 'deposit-settlement',
  WITHDRAWAL_SETTLEMENT = 'withdrawal-settlement',
  REFUND_SETTLEMENT = 'refund-settlement',
}

/** Socket.io namespace paths — one per realtime domain. */
export enum SocketNamespace {
  ROOT = '/',
  MATCHES = '/matches',
  LEADERBOARDS = '/leaderboards',
  WALLETS = '/wallets',
  NOTIFICATIONS = '/notifications',
  ADMIN = '/admin',
}

/** Canonical realtime event names (Redis pub/sub + Socket.io wire). */
export enum RealtimeEvent {
  MATCH_UPDATE = 'match:update',
  LEADERBOARD_UPDATED = 'leaderboard.updated',
  LEADERBOARD_RANK_CHANGED = 'leaderboard.rankChanged',
  LEADERBOARD_POINTS_CHANGED = 'leaderboard.pointsChanged',
  CONTEST_JOINED = 'contest.joined',
  CONTEST_FILLED = 'contest.filled',
  CONTEST_LOCKED = 'contest.locked',
  CONTEST_CANCELLED = 'contest.cancelled',
  WALLET_UPDATED = 'wallet.updated',
  WALLET_DEBITED = 'wallet.debited',
  WALLET_CREDITED = 'wallet.credited',
  DEPOSIT_COMPLETED = 'deposit.completed',
  WITHDRAWAL_APPROVED = 'withdrawal.approved',
  WITHDRAWAL_REJECTED = 'withdrawal.rejected',
  KYC_APPROVED = 'kyc.approved',
  KYC_REJECTED = 'kyc.rejected',
  NOTIFICATION_NEW = 'notification.new',
  NOTIFICATION_READ = 'notification.read',
  ADMIN_METRICS = 'admin.metrics',
}

export enum SocketEvent {
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  AUTH = 'auth',
  MATCH_UPDATE = 'match:update',
  LEADERBOARD_UPDATE = 'leaderboard:update',
  CONTEST_UPDATE = 'contest:update',
  NOTIFICATION = 'notification',
  /** Client → server room subscription helpers. */
  JOIN_ROOM = 'room:join',
  LEAVE_ROOM = 'room:leave',
}

/** In-app notification categories. */
export enum NotificationType {
  SYSTEM = 'SYSTEM',
  WALLET = 'WALLET',
  CONTEST = 'CONTEST',
  WINNINGS = 'WINNINGS',
  MATCH = 'MATCH',
  PROMOTION = 'PROMOTION',
}

// ─── PHASE 2 — Auth / RBAC / Audit ───────────────────────────────────────────

export enum SessionStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
  LOGGED_OUT = 'LOGGED_OUT',
}

export enum OtpPurpose {
  SIGNUP_EMAIL = 'SIGNUP_EMAIL',
  SIGNUP_PHONE = 'SIGNUP_PHONE',
  LOGIN_2FA = 'LOGIN_2FA',
  EMAIL_VERIFY = 'EMAIL_VERIFY',
  PHONE_VERIFY = 'PHONE_VERIFY',
  PHONE_AUTH = 'PHONE_AUTH',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

export enum OtpChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
}

export enum AuditAction {
  // Auth
  USER_SIGNUP = 'USER_SIGNUP',
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGIN_FAILED = 'USER_LOGIN_FAILED',
  USER_LOGOUT = 'USER_LOGOUT',
  USER_LOGOUT_ALL = 'USER_LOGOUT_ALL',
  TOKEN_REFRESHED = 'TOKEN_REFRESHED',
  TOKEN_REFRESH_REUSE = 'TOKEN_REFRESH_REUSE',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  PHONE_VERIFIED = 'PHONE_VERIFIED',
  OTP_REQUESTED = 'OTP_REQUESTED',
  OTP_VERIFIED = 'OTP_VERIFIED',
  OTP_FAILED = 'OTP_FAILED',

  // Session
  SESSION_REVOKED = 'SESSION_REVOKED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',

  // Admin
  ADMIN_USER_UPDATED = 'ADMIN_USER_UPDATED',
  ADMIN_USER_SUSPENDED = 'ADMIN_USER_SUSPENDED',
  ADMIN_USER_REACTIVATED = 'ADMIN_USER_REACTIVATED',
  ADMIN_ROLE_ASSIGNED = 'ADMIN_ROLE_ASSIGNED',
  ADMIN_ROLE_REVOKED = 'ADMIN_ROLE_REVOKED',
  ADMIN_SESSIONS_REVOKED = 'ADMIN_SESSIONS_REVOKED',

  // Security
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  RATE_LIMIT_HIT = 'RATE_LIMIT_HIT',

  // Wallet / Ledger (PHASE 3)
  WALLET_CREATED = 'WALLET_CREATED',
  WALLET_DEPOSIT = 'WALLET_DEPOSIT',
  WALLET_WITHDRAW = 'WALLET_WITHDRAW',
  WALLET_WITHDRAW_FAILED = 'WALLET_WITHDRAW_FAILED',
  WALLET_CONTEST_JOIN = 'WALLET_CONTEST_JOIN',
  WALLET_CONTEST_REFUND = 'WALLET_CONTEST_REFUND',
  WALLET_WINNING_CREDIT = 'WALLET_WINNING_CREDIT',
  WALLET_BONUS_CREDIT = 'WALLET_BONUS_CREDIT',
  WALLET_TX_REVERSED = 'WALLET_TX_REVERSED',
  WALLET_FROZEN = 'WALLET_FROZEN',
  WALLET_UNFROZEN = 'WALLET_UNFROZEN',
  ADMIN_WALLET_ADJUSTMENT = 'ADMIN_WALLET_ADJUSTMENT',
  ADMIN_WALLET_REFUND = 'ADMIN_WALLET_REFUND',
  SUSPICIOUS_FINANCIAL_ACTIVITY = 'SUSPICIOUS_FINANCIAL_ACTIVITY',

  // Payments / Withdrawals / KYC (PHASE 9)
  PAYMENT_ORDER_CREATED = 'PAYMENT_ORDER_CREATED',
  PAYMENT_WEBHOOK_RECEIVED = 'PAYMENT_WEBHOOK_RECEIVED',
  PAYMENT_SETTLED = 'PAYMENT_SETTLED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  WITHDRAWAL_REQUESTED = 'WITHDRAWAL_REQUESTED',
  WITHDRAWAL_APPROVED = 'WITHDRAWAL_APPROVED',
  WITHDRAWAL_REJECTED = 'WITHDRAWAL_REJECTED',
  WITHDRAWAL_COMPLETED = 'WITHDRAWAL_COMPLETED',
  KYC_SUBMITTED = 'KYC_SUBMITTED',
  KYC_APPROVED = 'KYC_APPROVED',
  KYC_REJECTED = 'KYC_REJECTED',
  FINANCIAL_SETTLEMENT_FAILED = 'FINANCIAL_SETTLEMENT_FAILED',
  RISK_FLAG_RAISED = 'RISK_FLAG_RAISED',

  // Sports ingestion (PHASE 4)
  SPORTS_SYNC_STARTED = 'SPORTS_SYNC_STARTED',
  SPORTS_SYNC_COMPLETED = 'SPORTS_SYNC_COMPLETED',
  SPORTS_SYNC_FAILED = 'SPORTS_SYNC_FAILED',
  SPORTS_PROVIDER_FAILOVER = 'SPORTS_PROVIDER_FAILOVER',
  SPORTS_CACHE_FLUSHED = 'SPORTS_CACHE_FLUSHED',
  ADMIN_MATCH_FEATURED = 'ADMIN_MATCH_FEATURED',
  ADMIN_MATCH_UNFEATURED = 'ADMIN_MATCH_UNFEATURED',
  ADMIN_MATCH_CANCELLED = 'ADMIN_MATCH_CANCELLED',

  // Fantasy (PHASE 5)
  FANTASY_TEAM_CREATED = 'FANTASY_TEAM_CREATED',
  FANTASY_TEAM_UPDATED = 'FANTASY_TEAM_UPDATED',
  FANTASY_TEAM_CLONED = 'FANTASY_TEAM_CLONED',
  FANTASY_TEAM_DELETED = 'FANTASY_TEAM_DELETED',
  FANTASY_TEAM_VALIDATION_FAILED = 'FANTASY_TEAM_VALIDATION_FAILED',
  ADMIN_FANTASY_RULE_CREATED = 'ADMIN_FANTASY_RULE_CREATED',
  ADMIN_FANTASY_RULE_UPDATED = 'ADMIN_FANTASY_RULE_UPDATED',
  ADMIN_FANTASY_RULE_ACTIVATED = 'ADMIN_FANTASY_RULE_ACTIVATED',
  ADMIN_FANTASY_SCORING_CREATED = 'ADMIN_FANTASY_SCORING_CREATED',
  ADMIN_FANTASY_SCORING_UPDATED = 'ADMIN_FANTASY_SCORING_UPDATED',
  ADMIN_FANTASY_SCORING_ACTIVATED = 'ADMIN_FANTASY_SCORING_ACTIVATED',

  // Contest (PHASE 6)
  CONTEST_CREATED = 'CONTEST_CREATED',
  CONTEST_UPDATED = 'CONTEST_UPDATED',
  CONTEST_CLONED = 'CONTEST_CLONED',
  CONTEST_CANCELLED = 'CONTEST_CANCELLED',
  CONTEST_STATUS_TRANSITIONED = 'CONTEST_STATUS_TRANSITIONED',
  CONTEST_JOINED = 'CONTEST_JOINED',
  CONTEST_JOIN_FAILED = 'CONTEST_JOIN_FAILED',
  CONTEST_JOIN_DUPLICATE = 'CONTEST_JOIN_DUPLICATE',
  CONTEST_JOIN_ROLLBACK = 'CONTEST_JOIN_ROLLBACK',
  CONTEST_ENTRY_REFUNDED = 'CONTEST_ENTRY_REFUNDED',
  CONTEST_TEMPLATE_CREATED = 'CONTEST_TEMPLATE_CREATED',
  CONTEST_TEMPLATE_UPDATED = 'CONTEST_TEMPLATE_UPDATED',
  CONTEST_TEMPLATE_DELETED = 'CONTEST_TEMPLATE_DELETED',
  CONTEST_PRIZE_UPDATED = 'CONTEST_PRIZE_UPDATED',
  CONTEST_SUSPICIOUS_ACTIVITY = 'CONTEST_SUSPICIOUS_ACTIVITY',

  // Scoring / Leaderboard / Settlement (PHASE 7)
  SCORING_RECOMPUTED = 'SCORING_RECOMPUTED',
  SCORING_FAILED = 'SCORING_FAILED',
  SCORING_MANUAL_ADJUSTMENT = 'SCORING_MANUAL_ADJUSTMENT',
  LEADERBOARD_REBUILT = 'LEADERBOARD_REBUILT',
  LEADERBOARD_SNAPSHOT_CREATED = 'LEADERBOARD_SNAPSHOT_CREATED',
  LEADERBOARD_FAILED = 'LEADERBOARD_FAILED',
  CONTEST_SETTLEMENT_STARTED = 'CONTEST_SETTLEMENT_STARTED',
  CONTEST_SETTLEMENT_COMPLETED = 'CONTEST_SETTLEMENT_COMPLETED',
  CONTEST_SETTLEMENT_FAILED = 'CONTEST_SETTLEMENT_FAILED',
  CONTEST_ENTRY_SETTLED = 'CONTEST_ENTRY_SETTLED',
  PRIZE_DISTRIBUTED = 'PRIZE_DISTRIBUTED',
  ADMIN_SCORING_RULE_ACTIVATED = 'ADMIN_SCORING_RULE_ACTIVATED',
  ADMIN_FANTASY_POINTS_ADJUSTED = 'ADMIN_FANTASY_POINTS_ADJUSTED',
}

export enum AuditOutcome {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

// ─── PHASE 4 — Sports Domain ─────────────────────────────────────────────

/**
 * Supported sports. NEVER rename a value — match documents reference these
 * strings. Add new sports only.
 */
export enum Sport {
  CRICKET = 'CRICKET',
  FOOTBALL = 'FOOTBALL',
  KABADDI = 'KABADDI',
  BASKETBALL = 'BASKETBALL',
}

/**
 * Match format. Sport-agnostic — interpretation is sport-specific. The
 * enum captures the high-level catalogue we surface in filters / UI.
 */
export enum MatchFormat {
  // Cricket
  T20 = 'T20',
  ODI = 'ODI',
  TEST = 'TEST',
  T10 = 'T10',
  HUNDRED = 'HUNDRED',
  // Football / Basketball / Kabaddi share these
  LEAGUE = 'LEAGUE',
  KNOCKOUT = 'KNOCKOUT',
  FRIENDLY = 'FRIENDLY',
  /** Generic / unknown — every sport accepts this. */
  STANDARD = 'STANDARD',
}

/**
 * Tournament lifecycle. Distinct from `MatchStatus` because a tournament
 * spans many matches and stays `ONGOING` while individual matches finish.
 */
export enum TournamentStatus {
  UPCOMING = 'UPCOMING',
  ONGOING = 'ONGOING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/**
 * Coarse-grained player role used for fantasy team construction.
 * Sport-specific positions live on `Player.position` as free-form strings
 * — this enum is what the contest engine reasons about.
 */
export enum PlayerRole {
  BATSMAN = 'BATSMAN',
  BOWLER = 'BOWLER',
  ALL_ROUNDER = 'ALL_ROUNDER',
  WICKET_KEEPER = 'WICKET_KEEPER',
  // Football
  GOALKEEPER = 'GOALKEEPER',
  DEFENDER = 'DEFENDER',
  MIDFIELDER = 'MIDFIELDER',
  FORWARD = 'FORWARD',
  // Basketball
  GUARD = 'GUARD',
  CENTER = 'CENTER',
  // Kabaddi
  RAIDER = 'RAIDER',
  DEFENDER_KABADDI = 'DEFENDER_KABADDI',
  ALL_ROUNDER_KABADDI = 'ALL_ROUNDER_KABADDI',
  /** Fallback when the upstream provider doesn't classify the player. */
  UNKNOWN = 'UNKNOWN',
}

export enum TeamSide {
  HOME = 'HOME',
  AWAY = 'AWAY',
}

/**
 * Granular match-update event types persisted to the `match_updates`
 * stream. Used by the live score worker + the future socket pipeline.
 */
export enum MatchUpdateType {
  SCORE = 'SCORE',
  STATUS = 'STATUS',
  WICKET = 'WICKET',
  GOAL = 'GOAL',
  PERIOD = 'PERIOD',
  TOSS = 'TOSS',
  COMMENTARY = 'COMMENTARY',
  GENERIC = 'GENERIC',
}

/**
 * Origin of a sports ingestion run. Used by audit logs + the admin
 * "manual sync" button to label runs in the UI.
 */
export enum SyncSource {
  SCHEDULED = 'SCHEDULED',
  MANUAL_ADMIN = 'MANUAL_ADMIN',
  WEBHOOK = 'WEBHOOK',
  SYSTEM_BOOT = 'SYSTEM_BOOT',
}

/**
 * Pluggable sports data provider keys. The `default` provider is always
 * available and ships with the platform; managed providers register on
 * boot if their env vars are configured.
 */
export enum SportsProviderKey {
  MOCK = 'MOCK',
  CRIC_API = 'CRIC_API',
  SPORT_RADAR = 'SPORT_RADAR',
  ROANUZ = 'ROANUZ',
}

// ─── PHASE 5 — Fantasy Domain ────────────────────────────────────────────

/**
 * Lifecycle of a saved fantasy team. Drafts live in a separate collection;
 * this enum tracks teams that have been *finalised* (saved with a name +
 * captain selection).
 *
 *  - `EDITABLE`   : created/updated and the match has not yet locked
 *  - `LOCKED`     : the underlying match crossed `lineupLockedAt`
 *  - `SCORED`     : Phase 7 has assigned points
 *  - `INVALIDATED`: validation re-run after a rule change failed; team is
 *                   kept for audit but cannot enter contests.
 */
export enum FantasyTeamStatus {
  EDITABLE = 'EDITABLE',
  LOCKED = 'LOCKED',
  SCORED = 'SCORED',
  INVALIDATED = 'INVALIDATED',
}

/**
 * Categories used by the configurable scoring engine. The actual point
 * values live in the `fantasy_scoring_rules` collection — this enum is
 * what services and reporting group by.
 */
export enum FantasyScoringCategory {
  BATTING = 'BATTING',
  BOWLING = 'BOWLING',
  FIELDING = 'FIELDING',
  BONUS = 'BONUS',
  PENALTY = 'PENALTY',
}

/**
 * Canonical scoring event codes. Storage stays string-typed so a tenant
 * can add new codes without a code change, but the enum lists the ones
 * the platform ships with so types stay first-class.
 */
export enum FantasyScoringEventCode {
  // Batting
  BATTING_RUN = 'BATTING_RUN',
  BATTING_BOUNDARY = 'BATTING_BOUNDARY',
  BATTING_SIX = 'BATTING_SIX',
  BATTING_FIFTY = 'BATTING_FIFTY',
  BATTING_HUNDRED = 'BATTING_HUNDRED',
  BATTING_DUCK = 'BATTING_DUCK',
  // Bowling
  BOWLING_WICKET = 'BOWLING_WICKET',
  BOWLING_MAIDEN = 'BOWLING_MAIDEN',
  BOWLING_DOT_BALL = 'BOWLING_DOT_BALL',
  BOWLING_THREE_WKT_HAUL = 'BOWLING_THREE_WKT_HAUL',
  BOWLING_FIVE_WKT_HAUL = 'BOWLING_FIVE_WKT_HAUL',
  // Fielding
  FIELDING_CATCH = 'FIELDING_CATCH',
  FIELDING_STUMPING = 'FIELDING_STUMPING',
  FIELDING_RUN_OUT_DIRECT = 'FIELDING_RUN_OUT_DIRECT',
  FIELDING_RUN_OUT_ASSIST = 'FIELDING_RUN_OUT_ASSIST',
  // Bonus / Penalty
  BONUS_PLAYER_OF_MATCH = 'BONUS_PLAYER_OF_MATCH',
  BONUS_IN_PLAYING_XI = 'BONUS_IN_PLAYING_XI',
  PENALTY_LOW_STRIKE_RATE = 'PENALTY_LOW_STRIKE_RATE',
  PENALTY_HIGH_ECONOMY = 'PENALTY_HIGH_ECONOMY',
  // Football
  FOOTBALL_GOAL = 'FOOTBALL_GOAL',
  FOOTBALL_ASSIST = 'FOOTBALL_ASSIST',
  FOOTBALL_CLEAN_SHEET = 'FOOTBALL_CLEAN_SHEET',
  FOOTBALL_SAVE = 'FOOTBALL_SAVE',
  FOOTBALL_YELLOW_CARD = 'FOOTBALL_YELLOW_CARD',
  FOOTBALL_RED_CARD = 'FOOTBALL_RED_CARD',
}

/**
 * Validation issue codes emitted by the fantasy validator. The UI maps
 * each code to a localised message; the backend returns the raw code so
 * clients can compose precise inline feedback.
 */
export enum FantasyValidationIssueCode {
  TEAM_SIZE_MISMATCH = 'TEAM_SIZE_MISMATCH',
  CREDITS_EXCEEDED = 'CREDITS_EXCEEDED',
  ROLE_MIN_NOT_MET = 'ROLE_MIN_NOT_MET',
  ROLE_MAX_EXCEEDED = 'ROLE_MAX_EXCEEDED',
  TEAM_PLAYER_LIMIT_EXCEEDED = 'TEAM_PLAYER_LIMIT_EXCEEDED',
  TEAM_PLAYER_LIMIT_NOT_MET = 'TEAM_PLAYER_LIMIT_NOT_MET',
  DUPLICATE_PLAYER = 'DUPLICATE_PLAYER',
  CAPTAIN_NOT_SELECTED = 'CAPTAIN_NOT_SELECTED',
  VICE_CAPTAIN_NOT_SELECTED = 'VICE_CAPTAIN_NOT_SELECTED',
  CAPTAIN_VICE_CAPTAIN_SAME = 'CAPTAIN_VICE_CAPTAIN_SAME',
  CAPTAIN_NOT_IN_LINEUP = 'CAPTAIN_NOT_IN_LINEUP',
  VICE_CAPTAIN_NOT_IN_LINEUP = 'VICE_CAPTAIN_NOT_IN_LINEUP',
  PLAYER_NOT_FOUND = 'PLAYER_NOT_FOUND',
  PLAYER_INACTIVE = 'PLAYER_INACTIVE',
  PLAYER_NOT_IN_MATCH = 'PLAYER_NOT_IN_MATCH',
  MATCH_LOCKED = 'MATCH_LOCKED',
  MAX_TEAMS_PER_USER_REACHED = 'MAX_TEAMS_PER_USER_REACHED',
  RULES_NOT_CONFIGURED = 'RULES_NOT_CONFIGURED',
}

/** Severity of an issue — controllers use this to decide HTTP semantics. */
export enum FantasyValidationSeverity {
  ERROR = 'ERROR',
  WARNING = 'WARNING',
}

// ─── PHASE 6 — Contest Domain ────────────────────────────────────────────

/**
 * High-level contest archetypes. Drives UI affordances (mega badges,
 * H2H pairing, etc.) plus the default prize-distribution shape.
 *
 *   MEGA            : largest prize pool, percentage payouts, big
 *                     guaranteed prize regardless of fill.
 *   GUARANTEED      : like REGULAR but the prize pool is "guaranteed"
 *                     i.e. paid out even if the contest does not fill.
 *   HEAD_TO_HEAD    : exactly two participants; winner takes 100%.
 *   PRACTICE        : free contest, prize pool is zero, used for
 *                     onboarding + game-mode discovery.
 *   PRIVATE         : custom contest created by a user from a template
 *                     (invite-only via `inviteCode`).
 *   REGULAR         : the default "small contest" archetype — used when
 *                     none of the special cases apply.
 *
 * NEVER rename a value here. Production audit data references these
 * strings — only add new ones.
 */
export enum ContestType {
  MEGA = 'MEGA',
  GUARANTEED = 'GUARANTEED',
  HEAD_TO_HEAD = 'HEAD_TO_HEAD',
  PRACTICE = 'PRACTICE',
  PRIVATE = 'PRIVATE',
  REGULAR = 'REGULAR',
}

/** Who can see / join a contest. PUBLIC is the default; PRIVATE requires
 *  the inviteCode; UNLISTED is reachable by direct link only. */
export enum ContestVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
  UNLISTED = 'UNLISTED',
}

/**
 * How the prize pool is distributed across ranks.
 *
 *   RANK_BASED       : each slab has a fixed `prizeAmount` (minor units).
 *   PERCENTAGE_BASED : each slab has a `percentage` of the prize pool;
 *                      sum of percentages must equal 100 (validated).
 *   FIXED            : flat payout — every slab pays `prizeAmount`,
 *                      typically used for H2H and "winner takes all".
 */
export enum PrizeDistributionType {
  RANK_BASED = 'RANK_BASED',
  PERCENTAGE_BASED = 'PERCENTAGE_BASED',
  FIXED = 'FIXED',
}

/**
 * Lifecycle of a single `contest_entries` row.
 *
 *   ACTIVE     : entry is live and counts towards `filledSpots`.
 *   REFUNDED   : contest was cancelled or user left before lock;
 *                wallet has been credited back.
 *   SETTLED    : winnings (or zero) credited after contest completion.
 *   CANCELLED  : entry was cancelled before the wallet debit completed
 *                (used during rollback flows; rare).
 */
export enum ContestEntryStatus {
  ACTIVE = 'ACTIVE',
  REFUNDED = 'REFUNDED',
  SETTLED = 'SETTLED',
  CANCELLED = 'CANCELLED',
}

/**
 * Audit actions emitted by the contest module. Appended to the catalogue
 * declared earlier — keep distinct names so a single `AuditAction` enum
 * still works as a discriminator across every domain.
 */
export enum ContestAuditAction {
  CONTEST_CREATED = 'CONTEST_CREATED',
  CONTEST_UPDATED = 'CONTEST_UPDATED',
  CONTEST_CLONED = 'CONTEST_CLONED',
  CONTEST_CANCELLED = 'CONTEST_CANCELLED',
  CONTEST_STATUS_TRANSITIONED = 'CONTEST_STATUS_TRANSITIONED',
  CONTEST_JOINED = 'CONTEST_JOINED',
  CONTEST_JOIN_FAILED = 'CONTEST_JOIN_FAILED',
  CONTEST_JOIN_DUPLICATE = 'CONTEST_JOIN_DUPLICATE',
  CONTEST_ENTRY_REFUNDED = 'CONTEST_ENTRY_REFUNDED',
  CONTEST_TEMPLATE_CREATED = 'CONTEST_TEMPLATE_CREATED',
  CONTEST_TEMPLATE_UPDATED = 'CONTEST_TEMPLATE_UPDATED',
  CONTEST_TEMPLATE_DELETED = 'CONTEST_TEMPLATE_DELETED',
  CONTEST_PRIZE_UPDATED = 'CONTEST_PRIZE_UPDATED',
  CONTEST_SUSPICIOUS_ACTIVITY = 'CONTEST_SUSPICIOUS_ACTIVITY',
}

/**
 * Validation issue codes emitted by the contest validator. Surfaced
 * back to the FE as machine-readable codes so client copy is localisable.
 */
export enum ContestValidationIssueCode {
  CONTEST_NOT_FOUND = 'CONTEST_NOT_FOUND',
  CONTEST_NOT_OPEN = 'CONTEST_NOT_OPEN',
  CONTEST_FULL = 'CONTEST_FULL',
  CONTEST_LOCKED = 'CONTEST_LOCKED',
  CONTEST_CANCELLED = 'CONTEST_CANCELLED',
  CONTEST_NOT_JOINABLE = 'CONTEST_NOT_JOINABLE',
  CONTEST_INVITE_CODE_REQUIRED = 'CONTEST_INVITE_CODE_REQUIRED',
  CONTEST_INVITE_CODE_INVALID = 'CONTEST_INVITE_CODE_INVALID',
  USER_ENTRY_LIMIT_REACHED = 'USER_ENTRY_LIMIT_REACHED',
  TEAM_ALREADY_JOINED = 'TEAM_ALREADY_JOINED',
  TEAM_INVALID_FOR_CONTEST = 'TEAM_INVALID_FOR_CONTEST',
  TEAM_NOT_OWNED = 'TEAM_NOT_OWNED',
  TEAM_LOCKED = 'TEAM_LOCKED',
  WALLET_INSUFFICIENT = 'WALLET_INSUFFICIENT',
  MATCH_LOCKED = 'MATCH_LOCKED',
  MATCH_NOT_FOUND = 'MATCH_NOT_FOUND',
}

// ─── PHASE 7 — Scoring + Leaderboard + Settlement ───────────────────────

/**
 * What kind of upstream event triggered a scoring entry. Used purely for
 * audit / observability — the scoring engine itself is event-agnostic.
 *
 *   LIVE_TICK          : routine recompute driven by live-score ingestion
 *   FINAL_RECONCILE    : final recompute when a match reaches COMPLETED
 *   MANUAL_RECOMPUTE   : an admin clicked "Recompute"
 *   POINTS_ADJUSTMENT  : an admin overrode points for a player
 *   RULE_CHANGE        : the active scoring rule was switched
 */
export enum ScoreEventType {
  LIVE_TICK = 'LIVE_TICK',
  FINAL_RECONCILE = 'FINAL_RECONCILE',
  MANUAL_RECOMPUTE = 'MANUAL_RECOMPUTE',
  POINTS_ADJUSTMENT = 'POINTS_ADJUSTMENT',
  RULE_CHANGE = 'RULE_CHANGE',
}

/** Lifecycle of a `score_events` row. */
export enum ScoreEventStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * Lifecycle of a contest's settlement. Tracked on the contest itself
 * (and mirrored on `contest_results`) so the worker is idempotent and
 * a partially-settled contest can be safely resumed.
 *
 *   NOT_STARTED   : contest reached COMPLETED but settlement queue
 *                   hasn't picked it up yet
 *   IN_PROGRESS   : settlement worker is currently allocating winnings
 *   SETTLED       : winnings credited, all entries flipped to SETTLED
 *   FAILED        : aborted mid-flight — admin tool needed to retry
 *   SKIPPED       : nothing to settle (e.g. 0 active entries)
 */
export enum ContestSettlementStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

/**
 * Scope of a leaderboard query. The same Redis-sorted-set primitive is
 * used for every scope — only the key namespace changes.
 *
 *   CONTEST   : rankings *within* one contest (the hot path).
 *   MATCH     : rankings across every fantasy team for a match,
 *               regardless of contest — used by the match leaderboard.
 *   USER      : a single user's rank history (Mongo-backed, no ZSET).
 */
export enum LeaderboardScope {
  CONTEST = 'CONTEST',
  MATCH = 'MATCH',
  USER = 'USER',
}

/** Direction a user's rank moved between two snapshots. */
export enum RankMovement {
  UP = 'UP',
  DOWN = 'DOWN',
  SAME = 'SAME',
  NEW = 'NEW',
}

/** Why a leaderboard snapshot was created (for observability). */
export enum LeaderboardSnapshotReason {
  LIVE_TICK = 'LIVE_TICK',
  PERIODIC = 'PERIODIC',
  FINAL = 'FINAL',
  MANUAL = 'MANUAL',
}

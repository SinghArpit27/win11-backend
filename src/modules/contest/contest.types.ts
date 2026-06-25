import type {
  ContestEntryStatus,
  ContestStatus,
  ContestType,
  ContestVisibility,
  MatchFormat,
  PrizeDistributionType,
  Sport,
} from '@common/enums';

/**
 * Public DTO surface of the contest module. Money values cross the wire
 * in **minor units** (paise / cents) unless the field name explicitly
 * ends in `Major` — frontend converts for display.
 *
 * Keep these shapes stable; consumers (mobile + web + admin) read them.
 */

// ── Prize ────────────────────────────────────────────────────────────

export interface PrizeSlabDTO {
  fromRank: number;
  toRank: number;
  prizeAmount: number;
  percentageBps: number;
  bonusLabel: string | null;
}

export interface PrizeDistributionDTO {
  id: string;
  name: string;
  description: string | null;
  type: PrizeDistributionType;
  referencePoolAmount: number;
  currency: string;
  slabs: PrizeSlabDTO[];
  maxWinningRank: number;
  isActive: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ── Template ─────────────────────────────────────────────────────────

export interface ContestTemplateDTO {
  id: string;
  name: string;
  description: string | null;
  type: ContestType;
  visibility: ContestVisibility;
  sport: Sport | null;
  format: MatchFormat | null;
  entryFee: number;
  prizePoolAmount: number;
  currency: string;
  isGuaranteed: boolean;
  totalSpots: number;
  maxEntriesPerUser: number;
  prizeDistributionId: string | null;
  tags: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Contest ──────────────────────────────────────────────────────────

export interface ContestPrizeSnapshotDTO {
  distributionId: string | null;
  name: string;
  type: PrizeDistributionType;
  poolAmount: number;
  maxWinningRank: number;
  slabs: PrizeSlabDTO[];
}

export interface ContestMatchSummaryDTO {
  id: string;
  sport: Sport;
  format: MatchFormat;
  scheduledAt: string;
  lineupLockedAt: string | null;
  status: string;
  homeTeam: { id: string; name: string; shortName: string; logoUrl: string | null } | null;
  awayTeam: { id: string; name: string; shortName: string; logoUrl: string | null } | null;
}

export interface ContestSummaryDTO {
  id: string;
  matchId: string;
  sport: Sport;
  format: MatchFormat;
  name: string;
  description: string | null;
  type: ContestType;
  visibility: ContestVisibility;
  status: ContestStatus;
  isPractice: boolean;
  isGuaranteed: boolean;
  /** Money (minor units). */
  entryFee: number;
  prizePoolAmount: number;
  currency: string;
  /** Top prize across all slabs — useful for the listing card. */
  topPrize: number;
  totalSpots: number;
  filledSpots: number;
  spotsLeft: number;
  fillPercentage: number;
  maxEntriesPerUser: number;
  joinOpensAt: string | null;
  joinClosesAt: string | null;
  publishedAt: string | null;
  hasInviteCode: boolean;
  /** Optimistic-lock counter; FE uses it to detect stale snapshots. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContestDTO extends ContestSummaryDTO {
  cancelledAt: string | null;
  cancellationReason: string | null;
  prizeSnapshot: ContestPrizeSnapshotDTO;
  templateId: string | null;
  clonedFromId: string | null;
  match: ContestMatchSummaryDTO | null;
  /**
   * Per-user signal (populated when the request was authenticated):
   * how many ACTIVE entries the caller has in this contest. Lets the
   * FE render "Joined (3)" / "Join Again" CTAs without a 2nd request.
   */
  myActiveEntryCount: number | null;
}

// ── Entry ────────────────────────────────────────────────────────────

export interface ContestEntryTeamSummaryDTO {
  id: string;
  name: string;
  accentColor: string | null;
  totalPoints: number;
}

export interface ContestEntryDTO {
  id: string;
  contestId: string;
  userId: string;
  matchId: string;
  teamId: string;
  entryFee: number;
  currency: string;
  entryNumber: number;
  status: ContestEntryStatus;
  rank: number | null;
  winningAmount: number;
  walletTransactionId: string | null;
  refundTransactionId: string | null;
  refundedAt: string | null;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Optional team snapshot, populated by the "my entries" endpoint. */
  team: ContestEntryTeamSummaryDTO | null;
  /** Optional contest snapshot, populated by the "my contests" endpoint. */
  contest: ContestSummaryDTO | null;
}

// ── Join flow ────────────────────────────────────────────────────────

export interface ContestJoinResultDTO {
  entry: ContestEntryDTO;
  contest: ContestSummaryDTO;
  /** Snapshot of the wallet after the debit. Lets FE update without a
   *  separate wallet refetch. */
  wallet: {
    spendable: number;
    locked: number;
    currency: string;
  };
}

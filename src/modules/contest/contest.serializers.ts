import type { HydratedDocument, Types } from 'mongoose';

import type { IFantasyTeam } from '@modules/fantasy/fantasy-team.model';
import type { IMatch } from '@modules/sports/match.model';
import type { ITeam } from '@modules/sports/team.model';

import type { IContestEntry } from './contest-entry.model';
import type { IContestTemplate } from './contest-template.model';
import type { IContest, IContestPrizeSlabSnapshot } from './contest.model';
import type {
  ContestDTO,
  ContestEntryDTO,
  ContestEntryTeamSummaryDTO,
  ContestMatchSummaryDTO,
  ContestPrizeSnapshotDTO,
  ContestSummaryDTO,
  ContestTemplateDTO,
  PrizeDistributionDTO,
  PrizeSlabDTO,
} from './contest.types';
import type { IPrizeDistribution, IPrizeSlab } from './prize-distribution.model';

/**
 * Domain → DTO serializers for the contest module.
 *
 * Serializers are pure functions over already-resolved references —
 * services do the IO; serializers only project. This keeps them trivial
 * to unit test and reuse from background workers (e.g. settlement
 * payouts, cache-refresh jobs).
 */

const toIso = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;

const idStr = (id: Types.ObjectId | string | null | undefined): string =>
  id ? String(id) : '';

const slabToDTO = (s: IPrizeSlab | IContestPrizeSlabSnapshot): PrizeSlabDTO => ({
  fromRank: s.fromRank,
  toRank: s.toRank,
  prizeAmount: s.prizeAmount,
  percentageBps: s.percentageBps,
  bonusLabel: s.bonusLabel ?? null,
});

// ─── Prize distribution ───────────────────────────────────────────────

export const prizeDistributionSerializer = {
  toDTO(doc: HydratedDocument<IPrizeDistribution>): PrizeDistributionDTO {
    return {
      id: String(doc._id),
      name: doc.name,
      description: doc.description ?? null,
      type: doc.type,
      referencePoolAmount: doc.referencePoolAmount,
      currency: doc.currency,
      slabs: doc.slabs.map(slabToDTO),
      maxWinningRank: doc.maxWinningRank,
      isActive: doc.isActive,
      tags: doc.tags ?? [],
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  },
};

// ─── Contest template ─────────────────────────────────────────────────

export const contestTemplateSerializer = {
  toDTO(doc: HydratedDocument<IContestTemplate>): ContestTemplateDTO {
    return {
      id: String(doc._id),
      name: doc.name,
      description: doc.description ?? null,
      type: doc.type,
      visibility: doc.visibility,
      sport: doc.sport ?? null,
      format: doc.format ?? null,
      entryFee: doc.entryFee,
      prizePoolAmount: doc.prizePoolAmount,
      currency: doc.currency,
      isGuaranteed: doc.isGuaranteed,
      totalSpots: doc.totalSpots,
      maxEntriesPerUser: doc.maxEntriesPerUser,
      prizeDistributionId: doc.prizeDistributionId ? idStr(doc.prizeDistributionId) : null,
      tags: doc.tags ?? [],
      isActive: doc.isActive,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  },
};

// ─── Contest ──────────────────────────────────────────────────────────

const computeTopPrize = (slabs: IContestPrizeSlabSnapshot[], poolAmount: number): number => {
  if (slabs.length === 0) return 0;
  return Math.max(
    ...slabs.map((s) => {
      if (s.percentageBps > 0) {
        return Math.floor((poolAmount * s.percentageBps) / 10_000);
      }
      return s.prizeAmount;
    }),
  );
};

const teamSummary = (team: HydratedDocument<ITeam> | null) =>
  team
    ? {
        id: String(team._id),
        name: team.name,
        shortName: team.shortName,
        logoUrl: team.logoUrl ?? null,
      }
    : null;

const matchSummary = (
  match: HydratedDocument<IMatch> | null,
  teams: { home: HydratedDocument<ITeam> | null; away: HydratedDocument<ITeam> | null },
): ContestMatchSummaryDTO | null => {
  if (!match) return null;
  return {
    id: String(match._id),
    sport: match.sport,
    format: match.format,
    scheduledAt: match.scheduledAt.toISOString(),
    lineupLockedAt: toIso(match.lineupLockedAt),
    status: match.status,
    homeTeam: teamSummary(teams.home),
    awayTeam: teamSummary(teams.away),
  };
};

const prizeSnapshotDTO = (snapshot: IContest['prizeSnapshot']): ContestPrizeSnapshotDTO => ({
  distributionId: snapshot.distributionId ? idStr(snapshot.distributionId) : null,
  name: snapshot.name,
  type: snapshot.type,
  poolAmount: snapshot.poolAmount,
  maxWinningRank: snapshot.maxWinningRank,
  slabs: snapshot.slabs.map(slabToDTO),
});

const summaryFromDoc = (doc: HydratedDocument<IContest>): ContestSummaryDTO => {
  const spotsLeft = Math.max(0, doc.totalSpots - doc.filledSpots);
  const fillPercentage =
    doc.totalSpots > 0
      ? Math.min(100, Math.round((doc.filledSpots / doc.totalSpots) * 100))
      : 0;
  return {
    id: String(doc._id),
    matchId: String(doc.matchId),
    sport: doc.sport,
    format: doc.format,
    name: doc.name,
    description: doc.description ?? null,
    type: doc.type,
    visibility: doc.visibility,
    status: doc.status,
    isPractice: doc.isPractice,
    isGuaranteed: doc.isGuaranteed,
    entryFee: doc.entryFee,
    prizePoolAmount: doc.prizePoolAmount,
    currency: doc.currency,
    topPrize: computeTopPrize(doc.prizeSnapshot.slabs, doc.prizeSnapshot.poolAmount),
    totalSpots: doc.totalSpots,
    filledSpots: doc.filledSpots,
    spotsLeft,
    fillPercentage,
    maxEntriesPerUser: doc.maxEntriesPerUser,
    joinOpensAt: toIso(doc.joinOpensAt),
    joinClosesAt: toIso(doc.joinClosesAt),
    publishedAt: toIso(doc.publishedAt),
    hasInviteCode: !!doc.inviteCode,
    templateId: doc.templateId ? idStr(doc.templateId) : null,
    version: doc.version,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
};

export interface ContestSerializerContext {
  match?: HydratedDocument<IMatch> | null;
  homeTeam?: HydratedDocument<ITeam> | null;
  awayTeam?: HydratedDocument<ITeam> | null;
  myActiveEntryCount?: number | null;
}

export const contestSerializer = {
  toSummary(doc: HydratedDocument<IContest>): ContestSummaryDTO {
    return summaryFromDoc(doc);
  },
  toDTO(doc: HydratedDocument<IContest>, ctx: ContestSerializerContext = {}): ContestDTO {
    const summary = summaryFromDoc(doc);
    return {
      ...summary,
      cancelledAt: toIso(doc.cancelledAt),
      cancellationReason: doc.cancellationReason ?? null,
      prizeSnapshot: prizeSnapshotDTO(doc.prizeSnapshot),
      clonedFromId: doc.clonedFromId ? idStr(doc.clonedFromId) : null,
      match: matchSummary(ctx.match ?? null, {
        home: ctx.homeTeam ?? null,
        away: ctx.awayTeam ?? null,
      }),
      myActiveEntryCount: ctx.myActiveEntryCount ?? null,
    };
  },
};

// ─── Contest entry ────────────────────────────────────────────────────

const teamEntrySummary = (
  team: HydratedDocument<IFantasyTeam> | null,
): ContestEntryTeamSummaryDTO | null =>
  team
    ? {
        id: String(team._id),
        name: team.name,
        accentColor: team.accentColor ?? null,
        totalPoints: team.totalPoints ?? 0,
      }
    : null;

export interface ContestEntrySerializerContext {
  team?: HydratedDocument<IFantasyTeam> | null;
  contest?: HydratedDocument<IContest> | null;
}

export const contestEntrySerializer = {
  toDTO(
    doc: HydratedDocument<IContestEntry>,
    ctx: ContestEntrySerializerContext = {},
  ): ContestEntryDTO {
    return {
      id: String(doc._id),
      contestId: String(doc.contestId),
      userId: String(doc.userId),
      matchId: String(doc.matchId),
      teamId: String(doc.teamId),
      entryFee: doc.entryFee,
      currency: doc.currency,
      entryNumber: doc.entryNumber,
      status: doc.status,
      rank: doc.rank ?? null,
      winningAmount: doc.winningAmount ?? 0,
      walletTransactionId: doc.walletTransactionId ? idStr(doc.walletTransactionId) : null,
      refundTransactionId: doc.refundTransactionId ? idStr(doc.refundTransactionId) : null,
      refundedAt: toIso(doc.refundedAt),
      joinedAt: doc.joinedAt.toISOString(),
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      team: teamEntrySummary(ctx.team ?? null),
      contest: ctx.contest ? summaryFromDoc(ctx.contest) : null,
    };
  },
};

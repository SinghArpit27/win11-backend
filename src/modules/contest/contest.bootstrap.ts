import { appIdentity } from '@config/env.config';
import { logger } from '@config/logger.config';

import { AppConstants } from '@common/constants';
import {
  ContestStatus,
  ContestType,
  ContestVisibility,
  MatchStatus,
  PrizeDistributionType,
} from '@common/enums';

import { Match } from '@modules/sports/match.model';

import { Contest } from './contest.model';
import { ContestTemplate, type IContestTemplate } from './contest-template.model';
import {
  PrizeDistribution,
  type IPrizeDistribution,
  type IPrizeSlab,
} from './prize-distribution.model';

/**
 * Idempotent contest module bootstrap.
 *
 * Seeds:
 *   1. A small library of *reusable prize distributions* (mega 70-30,
 *      H2H winner-takes-all, percentage 100-spot, practice-no-prize).
 *   2. A handful of *contest templates* that reference them — these
 *      surface immediately in the admin "Create from template" picker.
 *
 * Seeds NEVER touch existing rows — we look up by `(name, type)` and
 * only insert when missing. Admin edits (rename, deactivate, tune
 * slabs) survive every reboot.
 */

const MAJOR = AppConstants.MONEY.MINOR_UNITS_PER_MAJOR;
const CURRENCY = appIdentity.defaultCurrency;

interface PrizeSeedSpec {
  name: string;
  description: string;
  type: PrizeDistributionType;
  poolMajor: number;
  slabs: IPrizeSlab[];
  tags: string[];
}

const slab = (
  fromRank: number,
  toRank: number,
  opts: { prizeMinor?: number; percentageBps?: number; bonusLabel?: string | null } = {},
): IPrizeSlab => ({
  fromRank,
  toRank,
  prizeAmount: opts.prizeMinor ?? 0,
  percentageBps: opts.percentageBps ?? 0,
  bonusLabel: opts.bonusLabel ?? null,
});

const prizeSeeds: PrizeSeedSpec[] = [
  // ── Mega 100-spot — percentage split ───────────────────────────────
  {
    name: 'Mega 100 — 70/20/10',
    description: 'Top-heavy percentage split — 70% rank 1, 20% spread 2-5, 10% spread 6-20',
    type: PrizeDistributionType.PERCENTAGE_BASED,
    poolMajor: 1_00_000, // reference pool only; percentage slabs are pool-agnostic
    tags: ['mega', 'percentage'],
    slabs: [
      slab(1, 1, { percentageBps: 7_000 }),
      slab(2, 5, { percentageBps: 500 }), // 4 × 500 = 2_000 (20%)
      slab(6, 20, { percentageBps: Math.floor(1_000 / 15) }), // 15 × 66 ≈ 1000 (10%)
    ],
  },
  // ── Mega 100-spot — corrected exact 100% split ─────────────────────
  // The slabs above lose a few bps to rounding; this variant uses
  // explicit bps that sum to 10_000 cleanly. Kept as a separate
  // template so admins see both shapes.
  {
    name: 'Mega 100 — Top 20 Exact',
    description: 'Exact percentage split with no rounding loss — top 20 winners',
    type: PrizeDistributionType.PERCENTAGE_BASED,
    poolMajor: 1_00_000,
    tags: ['mega', 'percentage', 'curated'],
    slabs: [
      slab(1, 1, { percentageBps: 5_000 }),       // 50%
      slab(2, 2, { percentageBps: 1_500 }),       // 15%
      slab(3, 3, { percentageBps: 1_000 }),       // 10%
      slab(4, 4, { percentageBps: 750 }),         // 7.5%
      slab(5, 5, { percentageBps: 500 }),         // 5%
      slab(6, 10, { percentageBps: 200 }),        // 5 × 200 = 10%
      slab(11, 20, { percentageBps: 25 }),        // 10 × 25 = 2.5%
    ],
  },
  // ── H2H winner-takes-all ───────────────────────────────────────────
  {
    name: 'Head-to-Head — Winner Takes All',
    description: '100% of the prize pool to the rank-1 finisher',
    type: PrizeDistributionType.PERCENTAGE_BASED,
    poolMajor: 100,
    tags: ['h2h'],
    slabs: [slab(1, 1, { percentageBps: 10_000 })],
  },
  // ── Practice — no prize ────────────────────────────────────────────
  {
    name: 'Practice — No Prize',
    description: 'Used for free practice contests — no monetary payout',
    type: PrizeDistributionType.FIXED,
    poolMajor: 0,
    tags: ['practice'],
    slabs: [slab(1, 1, { prizeMinor: 0 })],
  },
];

const upsertPrizeDistribution = async (spec: PrizeSeedSpec): Promise<IPrizeDistribution> => {
  const existing = await PrizeDistribution.findOne({ name: spec.name }).exec();
  if (existing) return existing;
  const doc = await PrizeDistribution.create({
    name: spec.name,
    description: spec.description,
    type: spec.type,
    referencePoolAmount: spec.poolMajor * MAJOR,
    currency: CURRENCY,
    slabs: spec.slabs,
    maxWinningRank: spec.slabs.reduce((max, s) => Math.max(max, s.toRank), 0),
    isActive: true,
    tags: spec.tags,
  });
  logger.info({ name: doc.name }, 'contest.bootstrap.prize.seeded');
  return doc;
};

interface TemplateSeedSpec {
  name: string;
  description: string;
  type: ContestType;
  visibility: ContestVisibility;
  entryFeeMajor: number;
  prizePoolMajor: number;
  totalSpots: number;
  maxEntriesPerUser: number;
  isGuaranteed: boolean;
  prizeName: string; // matches a row above
  tags: string[];
}

const templateSeeds: TemplateSeedSpec[] = [
  {
    name: 'Mega Contest — 1L Prize Pool',
    description: '100 spots, ₹49 entry, ₹1L guaranteed prize pool with top-heavy payouts',
    type: ContestType.MEGA,
    visibility: ContestVisibility.PUBLIC,
    entryFeeMajor: 49,
    prizePoolMajor: 1_00_000,
    totalSpots: 2200, // 2200 × 49 = 1.078L > 1L guaranteed
    maxEntriesPerUser: 20,
    isGuaranteed: true,
    prizeName: 'Mega 100 — Top 20 Exact',
    tags: ['mega', 'flagship'],
  },
  {
    name: 'Head-to-Head ₹100',
    description: 'Classic 1v1 — entry ₹100, winner gets ₹180',
    type: ContestType.HEAD_TO_HEAD,
    visibility: ContestVisibility.PUBLIC,
    entryFeeMajor: 100,
    prizePoolMajor: 180,
    totalSpots: 2,
    maxEntriesPerUser: 1,
    isGuaranteed: false,
    prizeName: 'Head-to-Head — Winner Takes All',
    tags: ['h2h'],
  },
  {
    name: 'Practice Contest',
    description: 'Free entry, no prize — perfect for learning the game',
    type: ContestType.PRACTICE,
    visibility: ContestVisibility.PUBLIC,
    entryFeeMajor: 0,
    prizePoolMajor: 0,
    totalSpots: 5000,
    maxEntriesPerUser: 5,
    isGuaranteed: false,
    prizeName: 'Practice — No Prize',
    tags: ['practice', 'free'],
  },
  {
    name: 'Quick Win — ₹10 Pool',
    description: 'Low-stakes regular contest — 20 spots, ₹15 prize pool',
    type: ContestType.REGULAR,
    visibility: ContestVisibility.PUBLIC,
    entryFeeMajor: 1,
    prizePoolMajor: 15,
    totalSpots: 20,
    maxEntriesPerUser: 3,
    isGuaranteed: false,
    prizeName: 'Mega 100 — Top 20 Exact',
    tags: ['regular', 'starter'],
  },
];

const upsertTemplate = async (
  spec: TemplateSeedSpec,
  prizeMap: Map<string, IPrizeDistribution>,
): Promise<IContestTemplate> => {
  const existing = await ContestTemplate.findOne({ name: spec.name }).exec();
  if (existing) return existing;

  const prize = prizeMap.get(spec.prizeName);
  const doc = await ContestTemplate.create({
    name: spec.name,
    description: spec.description,
    type: spec.type,
    visibility: spec.visibility,
    sport: null,
    format: null,
    entryFee: spec.entryFeeMajor * MAJOR,
    prizePoolAmount: spec.prizePoolMajor * MAJOR,
    currency: CURRENCY,
    isGuaranteed: spec.isGuaranteed,
    totalSpots: spec.totalSpots,
    maxEntriesPerUser: spec.maxEntriesPerUser,
    prizeDistributionId: prize?._id ?? null,
    tags: spec.tags,
    isActive: true,
  });
  logger.info({ name: doc.name }, 'contest.bootstrap.template.seeded');
  return doc;
};

/**
 * Auto-spawns one OPEN contest per active template for every upcoming
 * match that has zero contests bound to it.
 *
 *  Why: makes a fresh DB *fully* explorable end-to-end — users can
 *  browse matches, see contests on each match, and join — without
 *  requiring an admin to manually click "Create contest" 50 times.
 *
 *  Idempotent: skips matches that already have at least one contest.
 *  Safe to re-run: relies on per-match counts so adding more templates
 *  later only seeds the deltas.
 */
const seedContestsForUpcomingMatches = async (
  templates: IContestTemplate[],
): Promise<{ matchesSeeded: number; contestsCreated: number }> => {
  if (templates.length === 0) return { matchesSeeded: 0, contestsCreated: 0 };

  const matches = await Match.find({
    status: MatchStatus.UPCOMING,
    isDeleted: { $ne: true },
  })
    .sort({ scheduledAt: 1 })
    .limit(20)
    .lean()
    .exec();

  if (matches.length === 0) return { matchesSeeded: 0, contestsCreated: 0 };

  let matchesSeeded = 0;
  let contestsCreated = 0;
  const prizeCache = new Map<string, IPrizeDistribution | null>();

  for (const match of matches) {
    // Skip matches that already have contests — we only seed empty ones.
    const existing = await Contest.countDocuments({
      matchId: match._id,
      isDeleted: { $ne: true },
    });
    if (existing > 0) continue;

    for (const template of templates) {
      const prizeId = template.prizeDistributionId
        ? String(template.prizeDistributionId)
        : null;
      let prize: IPrizeDistribution | null = null;
      if (prizeId) {
        if (!prizeCache.has(prizeId)) {
          prizeCache.set(
            prizeId,
            await PrizeDistribution.findById(prizeId).lean<IPrizeDistribution>().exec(),
          );
        }
        prize = prizeCache.get(prizeId) ?? null;
      }

      try {
        await Contest.create({
          matchId: match._id,
          sport: match.sport,
          format: match.format,
          name: template.name,
          description: template.description,
          type: template.type,
          visibility: template.visibility,
          status: ContestStatus.OPEN,
          publishedAt: new Date(),
          joinOpensAt: null,
          joinClosesAt: match.lineupLockedAt ?? match.scheduledAt ?? null,
          cancelledAt: null,
          cancellationReason: null,
          isPractice: template.type === ContestType.PRACTICE,
          isGuaranteed: template.isGuaranteed,
          entryFee: template.entryFee,
          prizePoolAmount: template.prizePoolAmount,
          currency: template.currency,
          totalSpots: template.totalSpots,
          filledSpots: 0,
          maxEntriesPerUser: template.maxEntriesPerUser,
          prizeSnapshot: {
            distributionId: prize?._id ?? null,
            name: prize?.name ?? template.name,
            type: prize?.type ?? PrizeDistributionType.RANK_BASED,
            poolAmount: template.prizePoolAmount,
            maxWinningRank: prize?.maxWinningRank ?? 1,
            slabs: prize?.slabs ?? [],
          },
          templateId: template._id,
          clonedFromId: null,
          createdBy: null,
          updatedBy: null,
          cancelledBy: null,
          version: 0,
          lastJoinedAt: null,
          distinctParticipantsCount: 0,
        });
        contestsCreated += 1;
      } catch (err) {
        logger.warn(
          { err, matchId: String(match._id), template: template.name },
          'contest.bootstrap.match-seed.failed',
        );
      }
    }
    matchesSeeded += 1;
  }

  return { matchesSeeded, contestsCreated };
};

/**
 * Keeps `joinClosesAt` aligned with the linked match schedule. Contests
 * seeded before a match reschedule carry a stale close timestamp that
 * blocks joins even when the fixture is still upcoming.
 */
export const reconcileContestJoinWindows = async (): Promise<number> => {
  const contests = await Contest.find({
    status: { $in: [ContestStatus.OPEN, ContestStatus.SCHEDULED] },
    isDeleted: { $ne: true },
  })
    .select({ _id: 1, matchId: 1, joinClosesAt: 1 })
    .lean()
    .exec();

  if (contests.length === 0) return 0;

  const matchIds = Array.from(new Set(contests.map((c) => String(c.matchId))));
  const matches = await Match.find({ _id: { $in: matchIds } })
    .select({ scheduledAt: 1, lineupLockedAt: 1 })
    .lean()
    .exec();
  const matchMap = new Map(matches.map((m) => [String(m._id), m]));

  let updated = 0;
  for (const contest of contests) {
    const match = matchMap.get(String(contest.matchId));
    if (!match) continue;

    const desiredClose = match.lineupLockedAt ?? match.scheduledAt ?? null;
    if (!desiredClose) continue;

    const currentMs = contest.joinClosesAt ? new Date(contest.joinClosesAt).getTime() : 0;
    if (desiredClose.getTime() > currentMs) {
      await Contest.updateOne(
        { _id: contest._id },
        { $set: { joinClosesAt: desiredClose } },
      ).exec();
      updated += 1;
    }
  }

  if (updated > 0) {
    logger.info({ updated }, 'contest.bootstrap.join-windows.reconciled');
  }
  return updated;
};

/**
 * Public contests must omit `inviteCode` entirely — storing null breaks the
 * sparse unique index (only one null allowed). Cleans legacy rows on boot.
 */
export const repairContestInviteCodes = async (): Promise<void> => {
  try {
    const indexes = await Contest.collection.indexes();
    const inviteIndex = indexes.find((idx) => idx.name === 'inviteCode_1');
    if (inviteIndex && !inviteIndex.sparse) {
      await Contest.collection.dropIndex('inviteCode_1');
      logger.info('contest.inviteCode.index.dropped-non-sparse');
    }

    const unset = await Contest.updateMany(
      { inviteCode: null },
      { $unset: { inviteCode: '' } },
    );
    if (unset.modifiedCount > 0) {
      logger.info({ count: unset.modifiedCount }, 'contest.inviteCode.unset-null');
    }

    await Contest.syncIndexes();
  } catch (err) {
    logger.warn({ err }, 'contest.inviteCode.repair.failed');
  }
};

/**
 * Idempotent entry point — called from the loader on boot. Failures
 * are logged but never abort startup (the rest of the app can still
 * function; admins can manually seed via the admin UI).
 */
export const initContestSeeds = async (): Promise<void> => {
  try {
    await repairContestInviteCodes();

    const prizes = await Promise.all(prizeSeeds.map(upsertPrizeDistribution));
    const prizeMap = new Map(prizes.map((p) => [p.name, p]));
    const templates = await Promise.all(
      templateSeeds.map((t) => upsertTemplate(t, prizeMap)),
    );

    // Auto-seed actual contests per upcoming match so the listing UI
    // is non-empty on a fresh DB.
    const seedResult = await seedContestsForUpcomingMatches(
      templates.filter((t) => t.isActive),
    );
    if (seedResult.contestsCreated > 0) {
      logger.info(seedResult, 'contest.bootstrap.match-contests.seeded');
    }

    await reconcileContestJoinWindows();

    logger.info('contest.bootstrap.complete');
  } catch (err) {
    logger.warn({ err }, 'contest.bootstrap.failed (non-fatal)');
  }
};

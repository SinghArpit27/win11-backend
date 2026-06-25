import { logger } from '@config/logger.config';

import {
  FantasyScoringCategory,
  FantasyScoringEventCode,
  MatchFormat,
  PlayerRole,
  Sport,
} from '@common/enums';

import {
  FantasyRule,
  defaultCricketT20RuleSeed,
  defaultCricketT20ScoringSeed,
  FantasyScoringRule,
} from './index';
import type { IFantasyRule } from './fantasy-rule.model';
import type { IFantasyScoringRule } from './fantasy-scoring-rule.model';

/**
 * Idempotent fantasy bootstrap.
 *
 * On boot we make sure the platform always has at least one active rule
 * set + scoring rule set per shipped (sport, format) combination so the
 * `fantasy_match_context` endpoint never returns `null` rules to the
 * client. This is safe to run on every boot — we check `findOne` before
 * inserting.
 *
 * Why we seed *every* format we ship:
 *  - The sports-data ingestion layer can produce matches in any cricket
 *    format (T20 / ODI / TEST / T10) or football LEAGUE, depending on
 *    the upstream provider's catalogue. Without a rule for that exact
 *    (sport, format), the create-team screen surfaces the
 *    `FANTASY_RULES_NOT_CONFIGURED` error. Seeding all formats removes
 *    this dead-end for fresh environments while still letting admins
 *    override anything via the admin API.
 *
 *  - Admins can override or deactivate seeded rules at any time; we
 *    never mutate existing rows, so customisations survive reboots.
 */

interface SeedSpec {
  sport: Sport;
  format: MatchFormat;
  rule: Partial<IFantasyRule>;
  scoring: Partial<IFantasyScoringRule>;
}

/**
 * Derive a same-shape rule from the cricket T20 default for another
 * cricket format. We keep team size / role caps / credit budget so the
 * UX is consistent across formats; admins can fine-tune later.
 */
const cricketRuleVariant = (format: MatchFormat, label: string): Partial<IFantasyRule> => ({
  ...defaultCricketT20RuleSeed,
  format,
  name: `Cricket ${label} — Default`,
  description: `Default Cricket ${label} fantasy team-building rules`,
});

const cricketScoringVariant = (
  format: MatchFormat,
  label: string,
): Partial<IFantasyScoringRule> => ({
  ...defaultCricketT20ScoringSeed,
  format,
  name: `Cricket ${label} — Default scoring`,
  description: `Default Cricket ${label} fantasy scoring rules`,
});

// ─── Football LEAGUE defaults ─────────────────────────────────────────
// Football fantasy mirrors Dream11's standard 11-player setup with
// goalkeeper / defender / midfielder / forward role caps. Scoring is
// kept intentionally compact — admins are expected to tune via the
// admin API for production.
const footballLeagueRuleSeed: Partial<IFantasyRule> = {
  sport: Sport.FOOTBALL,
  format: MatchFormat.LEAGUE,
  name: 'Football League — Default',
  description: 'Default Football League fantasy team-building rules',
  isActive: true,
  teamSize: 11,
  creditBudget: 100,
  minPerPlayerCredits: 6,
  maxPerPlayerCredits: 12,
  minFromSingleTeam: 3,
  maxFromSingleTeam: 7,
  roleConstraints: [
    { role: PlayerRole.GOALKEEPER, min: 1, max: 1 },
    { role: PlayerRole.DEFENDER, min: 3, max: 5 },
    { role: PlayerRole.MIDFIELDER, min: 3, max: 5 },
    { role: PlayerRole.FORWARD, min: 1, max: 3 },
  ],
  captainMultiplier: 2,
  viceCaptainMultiplier: 1.5,
  maxTeamsPerUserPerMatch: 20,
  warnAtTeamsPerUserPerMatch: 15,
  version: 1,
};

const footballLeagueScoringSeed: Partial<IFantasyScoringRule> = {
  sport: Sport.FOOTBALL,
  format: MatchFormat.LEAGUE,
  name: 'Football League — Default scoring',
  description: 'Default Football League fantasy scoring rules',
  isActive: true,
  version: 1,
  events: [
    {
      code: FantasyScoringEventCode.BONUS_IN_PLAYING_XI,
      category: FantasyScoringCategory.BONUS,
      label: 'Played the match',
      statKey: 'playedMatch',
      points: 4,
      threshold: 1,
      unit: null,
      appliesTo: [],
      sortOrder: 1,
    },
    {
      code: FantasyScoringEventCode.BONUS_PLAYER_OF_MATCH,
      category: FantasyScoringCategory.BONUS,
      label: 'Player of the match',
      statKey: 'playerOfMatch',
      points: 10,
      threshold: 1,
      unit: null,
      appliesTo: [],
      sortOrder: 2,
    },
  ],
};

const SEEDS: SeedSpec[] = [
  // Cricket — primary T20 ruleset
  {
    sport: Sport.CRICKET,
    format: MatchFormat.T20,
    rule: defaultCricketT20RuleSeed,
    scoring: defaultCricketT20ScoringSeed,
  },
  // Cricket — variants reused from the T20 base
  {
    sport: Sport.CRICKET,
    format: MatchFormat.T10,
    rule: cricketRuleVariant(MatchFormat.T10, 'T10'),
    scoring: cricketScoringVariant(MatchFormat.T10, 'T10'),
  },
  {
    sport: Sport.CRICKET,
    format: MatchFormat.ODI,
    rule: cricketRuleVariant(MatchFormat.ODI, 'ODI'),
    scoring: cricketScoringVariant(MatchFormat.ODI, 'ODI'),
  },
  {
    sport: Sport.CRICKET,
    format: MatchFormat.TEST,
    rule: cricketRuleVariant(MatchFormat.TEST, 'Test'),
    scoring: cricketScoringVariant(MatchFormat.TEST, 'Test'),
  },
  {
    sport: Sport.CRICKET,
    format: MatchFormat.HUNDRED,
    rule: cricketRuleVariant(MatchFormat.HUNDRED, 'Hundred'),
    scoring: cricketScoringVariant(MatchFormat.HUNDRED, 'Hundred'),
  },
  // Football
  {
    sport: Sport.FOOTBALL,
    format: MatchFormat.LEAGUE,
    rule: footballLeagueRuleSeed,
    scoring: footballLeagueScoringSeed,
  },
];

const seedRule = async (spec: SeedSpec): Promise<void> => {
  const existing = await FantasyRule.findOne({
    sport: spec.sport,
    format: spec.format,
  }).exec();
  if (existing) {
    logger.debug({ sport: spec.sport, format: spec.format }, 'fantasy.rule.seed.skipped');
    return;
  }
  await FantasyRule.create(spec.rule);
  logger.info({ sport: spec.sport, format: spec.format }, 'fantasy.rule.seed.created');
};

const seedScoringRule = async (spec: SeedSpec): Promise<void> => {
  const existing = await FantasyScoringRule.findOne({
    sport: spec.sport,
    format: spec.format,
  }).exec();
  if (existing) {
    logger.debug(
      { sport: spec.sport, format: spec.format },
      'fantasy.scoring-rule.seed.skipped',
    );
    return;
  }
  await FantasyScoringRule.create(spec.scoring);
  logger.info(
    { sport: spec.sport, format: spec.format },
    'fantasy.scoring-rule.seed.created',
  );
};

export const initFantasySeeds = async (): Promise<void> => {
  for (const spec of SEEDS) {
    try {
      await seedRule(spec);
      await seedScoringRule(spec);
    } catch (err) {
      logger.warn({ err, sport: spec.sport, format: spec.format }, 'fantasy.seed.failed');
    }
  }
};

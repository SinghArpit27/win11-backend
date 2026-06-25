import type { Types } from 'mongoose';

import {
  ContestStatus,
  ContestType,
  ContestVisibility,
  MatchFormat,
  MatchStatus,
  PlayerRole,
  PrizeDistributionType,
  Sport,
  TournamentStatus,
} from '@common/enums';

import { Contest, type IContest } from '@modules/contest/contest.model';
import {
  defaultCricketT20RuleSeed,
  defaultCricketT20ScoringSeed,
  FantasyRule,
  FantasyScoringRule,
} from '@modules/fantasy';
import { Match, type IMatch } from '@modules/sports/match.model';
import { Player, type IPlayer } from '@modules/sports/player.model';
import { PlayerStats } from '@modules/sports/player-stats.model';
import { Team, type ITeam } from '@modules/sports/team.model';
import { Tournament, type ITournament } from '@modules/sports/tournament.model';

import {
  buildAwaySquadSpecs,
  buildHomeSquadSpecs,
  type SquadPlayerSpec,
} from '../fixtures/cricket-squad.fixture';
import { futureDate } from '../generators/mock-data.generator';

export interface SeededPlayer extends IPlayer {
  _id: Types.ObjectId;
}

export interface TestWorldSeed {
  matchId: string;
  tournament: ITournament;
  homeTeam: ITeam;
  awayTeam: ITeam;
  match: IMatch;
  players: SeededPlayer[];
  homePlayers: SeededPlayer[];
  awayPlayers: SeededPlayer[];
  practiceContest: IContest;
  paidContest: IContest;
}

const createPlayersForTeam = async (
  teamId: Types.ObjectId,
  specs: SquadPlayerSpec[],
): Promise<SeededPlayer[]> => {
  const docs = await Player.insertMany(
    specs.map((spec) => ({
      sport: Sport.CRICKET,
      name: spec.name,
      shortName: spec.name.split(' ').pop() ?? spec.name,
      role: spec.role as PlayerRole,
      teamId,
      country: 'IN',
      isActive: true,
      baseCredits: spec.baseCredits ?? 9,
      externalIds: [],
    })),
  );
  return docs as SeededPlayer[];
};

const createPlayerStats = async (matchId: Types.ObjectId, players: SeededPlayer[]): Promise<void> => {
  await PlayerStats.insertMany(
    players.map((player) => ({
      matchId,
      playerId: player._id,
      sport: Sport.CRICKET,
      teamId: player.teamId,
      isInLineup: true,
      isPlayed: false,
      isPlayerOfMatch: false,
      stats: {},
      fantasyPoints: 0,
    })),
  );
};

const seedFantasyRules = async (): Promise<void> => {
  const existing = await FantasyRule.findOne({
    sport: Sport.CRICKET,
    format: MatchFormat.T20,
    isActive: true,
  }).exec();
  if (!existing) {
    await FantasyRule.create(defaultCricketT20RuleSeed);
  }

  const existingScoring = await FantasyScoringRule.findOne({
    sport: Sport.CRICKET,
    format: MatchFormat.T20,
    isActive: true,
  }).exec();
  if (!existingScoring) {
    await FantasyScoringRule.create(defaultCricketT20ScoringSeed);
  }
};

const createContest = async (args: {
  matchId: Types.ObjectId;
  sport: Sport;
  format: MatchFormat;
  joinClosesAt: Date;
  name: string;
  type: ContestType;
  entryFeeMinor: number;
  prizePoolMinor: number;
  totalSpots: number;
  maxEntriesPerUser: number;
  isPractice: boolean;
}): Promise<IContest> => {
  const now = new Date();
  const inserted = await Contest.collection.insertOne({
    matchId: args.matchId,
    sport: args.sport,
    format: args.format,
    name: args.name,
    description: `${args.name} integration test contest`,
    type: args.type,
    visibility: ContestVisibility.PUBLIC,
    status: ContestStatus.OPEN,
    publishedAt: now,
    joinOpensAt: null,
    joinClosesAt: args.joinClosesAt,
    cancelledAt: null,
    cancellationReason: null,
    isPractice: args.isPractice,
    isGuaranteed: false,
    entryFee: args.entryFeeMinor,
    prizePoolAmount: args.prizePoolMinor,
    currency: 'INR',
    totalSpots: args.totalSpots,
    filledSpots: 0,
    maxEntriesPerUser: args.maxEntriesPerUser,
    prizeSnapshot: {
      distributionId: null,
      name: args.name,
      type: PrizeDistributionType.RANK_BASED,
      poolAmount: args.prizePoolMinor,
      maxWinningRank: 1,
      slabs: [],
    },
    templateId: null,
    clonedFromId: null,
    createdBy: null,
    updatedBy: null,
    cancelledBy: null,
    version: 1,
    lastJoinedAt: null,
    distinctParticipantsCount: 0,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  });

  const doc = await Contest.findById(inserted.insertedId).lean<IContest>().exec();
  if (!doc) {
    throw new Error('Failed to seed contest');
  }
  return doc;
};

/**
 * Seeds a minimal cricket world: tournament, teams, match, players, fantasy rules,
 * and two contests (practice + paid).
 */
export const seedTestWorld = async (): Promise<TestWorldSeed> => {
  await seedFantasyRules();

  const tournament = await Tournament.create({
    sport: Sport.CRICKET,
    name: 'Integration Test League',
    shortName: 'ITL',
    season: '2026',
    country: 'IN',
    status: TournamentStatus.UPCOMING,
    startDate: futureDate(1),
    endDate: futureDate(30),
    externalIds: [{ providerKey: 'test', id: 'itl-2026' }],
  });

  const homeTeam = await Team.create({
    sport: Sport.CRICKET,
    name: 'Integration Home XI',
    shortName: 'IHX',
    country: 'IN',
    tags: ['test'],
    externalIds: [{ providerKey: 'test', id: 'ihx' }],
  });

  const awayTeam = await Team.create({
    sport: Sport.CRICKET,
    name: 'Integration Away XI',
    shortName: 'IAX',
    country: 'IN',
    tags: ['test'],
    externalIds: [{ providerKey: 'test', id: 'iax' }],
  });

  const scheduledAt = futureDate(3);
  const lineupLockedAt = futureDate(2);

  const match = await Match.create({
    sport: Sport.CRICKET,
    format: MatchFormat.T20,
    tournamentId: tournament._id,
    homeTeamId: homeTeam._id,
    awayTeamId: awayTeam._id,
    status: MatchStatus.UPCOMING,
    scheduledAt,
    startedAt: null,
    completedAt: null,
    lineupLockedAt,
    venue: { name: 'Test Ground', city: 'Mumbai', country: 'IN' },
    scores: [],
    resultSummary: null,
    winnerTeamId: null,
    tossWinnerTeamId: null,
    tossDecision: null,
    isFeatured: false,
    popularityScore: 0,
    viewCount: 0,
    externalIds: [{ providerKey: 'test', id: 'match-it-1' }],
    providerSeasonKey: 'itl-2026',
    lastSyncedAt: null,
    lastUpdateAt: null,
  });

  const homePlayers = await createPlayersForTeam(homeTeam._id, buildHomeSquadSpecs());
  const awayPlayers = await createPlayersForTeam(awayTeam._id, buildAwaySquadSpecs());
  const players = [...homePlayers, ...awayPlayers];

  await createPlayerStats(match._id, players);

  const joinClosesAt = match.lineupLockedAt ?? match.scheduledAt;

  const practiceContest = await createContest({
    matchId: match._id,
    sport: match.sport,
    format: match.format,
    joinClosesAt,
    name: 'Practice Contest — Integration',
    type: ContestType.PRACTICE,
    entryFeeMinor: 0,
    prizePoolMinor: 0,
    totalSpots: 5000,
    maxEntriesPerUser: 5,
    isPractice: true,
  });

  const paidContest = await createContest({
    matchId: match._id,
    sport: match.sport,
    format: match.format,
    joinClosesAt,
    name: 'Paid Contest — Integration',
    type: ContestType.REGULAR,
    entryFeeMinor: 100,
    prizePoolMinor: 1500,
    totalSpots: 100,
    maxEntriesPerUser: 3,
    isPractice: false,
  });

  return {
    matchId: String(match._id),
    tournament: tournament.toObject() as ITournament,
    homeTeam: homeTeam.toObject() as ITeam,
    awayTeam: awayTeam.toObject() as ITeam,
    match: match.toObject() as IMatch,
    players,
    homePlayers,
    awayPlayers,
    practiceContest,
    paidContest,
  };
};

export { seedFantasyRules };

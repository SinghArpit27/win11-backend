import {
  MatchFormat,
  MatchStatus,
  MatchUpdateType,
  PlayerRole,
  Sport,
  SportsProviderKey,
  TournamentStatus,
} from '@common/enums';

import type {
  ISportsProvider,
  ProviderHealth,
  ProviderLiveUpdateDTO,
  ProviderMatchDTO,
  ProviderPlayerDTO,
  ProviderQuery,
  ProviderTeamDTO,
  ProviderTournamentDTO,
} from './sports-provider.types';

/**
 * Mock sports provider — always available, never makes network calls.
 *
 * Generates a deterministic-ish catalogue of cricket + football fixtures
 * so the platform stays demo-able / dev-runnable without an external API
 * key. Random elements are seeded by the current 5-minute bucket so the
 * roster stays stable across rapid-fire requests but rotates over time.
 *
 * In production this provider is still useful for:
 *   - smoke-testing the ingestion + cache pipeline,
 *   - QA environments without paid feeds,
 *   - failover demos.
 */
class MockSportsProvider implements ISportsProvider {
  public readonly key = SportsProviderKey.MOCK;
  public readonly displayName = 'Mock Sports Provider';
  public readonly supportedSports: ReadonlyArray<Sport> = [
    Sport.CRICKET,
    Sport.FOOTBALL,
  ];

  async health(): Promise<ProviderHealth> {
    return { ok: true, latencyMs: 0, message: 'mock-provider' };
  }

  async fetchTournaments(query?: ProviderQuery): Promise<ProviderTournamentDTO[]> {
    const tournaments = MOCK_TOURNAMENTS;
    return this.filterBySport(tournaments, query?.sport);
  }

  async fetchTeams(query?: ProviderQuery): Promise<ProviderTeamDTO[]> {
    return this.filterBySport(MOCK_TEAMS, query?.sport);
  }

  async fetchPlayers(query?: ProviderQuery): Promise<ProviderPlayerDTO[]> {
    return this.filterBySport(MOCK_PLAYERS, query?.sport);
  }

  async fetchMatches(query?: ProviderQuery): Promise<ProviderMatchDTO[]> {
    const matches = generateMatches();
    return this.filterBySport(matches, query?.sport);
  }

  async fetchLiveUpdates(query?: ProviderQuery): Promise<ProviderLiveUpdateDTO[]> {
    const matches = generateMatches().filter((m) => m.status === MatchStatus.LIVE);
    const filtered = this.filterBySport(matches, query?.sport);
    const now = Date.now();
    return filtered.map((m) => ({
      matchProviderId: m.id,
      eventId: `${m.id}-${Math.floor(now / 10_000)}`,
      type: MatchUpdateType.SCORE,
      occurredAt: new Date().toISOString(),
      payload: {
        homeScore: m.scores[0]?.score ?? 0,
        awayScore: m.scores[1]?.score ?? 0,
        commentary: `Live ticker — ${m.scores[0]?.score}-${m.scores[1]?.score}`,
      },
    }));
  }

  private filterBySport<T extends { sport: Sport }>(rows: T[], sport?: Sport): T[] {
    return sport ? rows.filter((r) => r.sport === sport) : rows;
  }
}

// ─── Static catalogue ─────────────────────────────────────────────────────
// Keep this small but representative. Two cricket tournaments + one
// football league + 6 teams + 6 players is enough to exercise every UI
// surface without bloating the test database.

const MOCK_TOURNAMENTS: ProviderTournamentDTO[] = [
  {
    id: 'tour-ipl-2026',
    sport: Sport.CRICKET,
    name: 'Indian Premier League 2026',
    shortName: 'IPL 2026',
    season: '2026',
    country: 'IND',
    status: TournamentStatus.ONGOING,
    startDate: '2026-03-22T00:00:00.000Z',
    endDate: '2026-05-26T00:00:00.000Z',
    logoUrl: null,
    accentColor: '#E53935',
  },
  {
    id: 'tour-wt20-2026',
    sport: Sport.CRICKET,
    name: 'ICC Men T20 World Cup 2026',
    shortName: 'T20 WC 2026',
    season: '2026',
    country: 'INT',
    status: TournamentStatus.UPCOMING,
    startDate: '2026-06-12T00:00:00.000Z',
    endDate: '2026-07-05T00:00:00.000Z',
    logoUrl: null,
    accentColor: '#1A237E',
  },
  {
    id: 'tour-women-bilateral-2026',
    sport: Sport.CRICKET,
    name: 'ENG-W vs NZ-W T20I Series 2026',
    shortName: 'ENGW v NZW',
    season: '2026',
    country: 'INT',
    status: TournamentStatus.UPCOMING,
    startDate: '2026-05-25T00:00:00.000Z',
    endDate: '2026-06-05T00:00:00.000Z',
    logoUrl: null,
    accentColor: '#0B5530',
  },
  {
    id: 'tour-epl-2526',
    sport: Sport.FOOTBALL,
    name: 'English Premier League 2025-26',
    shortName: 'EPL 25/26',
    season: '2025-26',
    country: 'ENG',
    status: TournamentStatus.ONGOING,
    startDate: '2025-08-15T00:00:00.000Z',
    endDate: '2026-05-24T00:00:00.000Z',
    logoUrl: null,
    accentColor: '#37003C',
  },
];

const MOCK_TEAMS: ProviderTeamDTO[] = [
  {
    id: 'team-mi',
    sport: Sport.CRICKET,
    name: 'Mumbai Indians',
    shortName: 'MI',
    country: 'IND',
    logoUrl: null,
    primaryColor: '#004BA0',
    secondaryColor: '#D1AB3E',
  },
  {
    id: 'team-csk',
    sport: Sport.CRICKET,
    name: 'Chennai Super Kings',
    shortName: 'CSK',
    country: 'IND',
    logoUrl: null,
    primaryColor: '#FDB913',
    secondaryColor: '#005DB7',
  },
  {
    id: 'team-rcb',
    sport: Sport.CRICKET,
    name: 'Royal Challengers Bengaluru',
    shortName: 'RCB',
    country: 'IND',
    logoUrl: null,
    primaryColor: '#E2231A',
    secondaryColor: '#000000',
  },
  {
    id: 'team-ind',
    sport: Sport.CRICKET,
    name: 'India',
    shortName: 'IND',
    country: 'IND',
    logoUrl: null,
    primaryColor: '#0033A0',
    secondaryColor: '#FF671F',
  },
  {
    id: 'team-aus',
    sport: Sport.CRICKET,
    name: 'Australia',
    shortName: 'AUS',
    country: 'AUS',
    logoUrl: null,
    primaryColor: '#FFCD00',
    secondaryColor: '#00843D',
  },
  {
    id: 'team-eng-w',
    sport: Sport.CRICKET,
    name: 'England Women',
    shortName: 'ENG-W',
    country: 'ENG',
    logoUrl: null,
    primaryColor: '#C8102E',
    secondaryColor: '#012169',
  },
  {
    id: 'team-nz-w',
    sport: Sport.CRICKET,
    name: 'New Zealand Women',
    shortName: 'NZ-W',
    country: 'NZL',
    logoUrl: null,
    primaryColor: '#000000',
    secondaryColor: '#CCCCCC',
  },
  {
    id: 'team-mci',
    sport: Sport.FOOTBALL,
    name: 'Manchester City',
    shortName: 'MCI',
    country: 'ENG',
    logoUrl: null,
    primaryColor: '#6CABDD',
    secondaryColor: '#1C2C5B',
  },
  {
    id: 'team-mun',
    sport: Sport.FOOTBALL,
    name: 'Manchester United',
    shortName: 'MUN',
    country: 'ENG',
    logoUrl: null,
    primaryColor: '#DA291C',
    secondaryColor: '#FBE122',
  },
];

const MOCK_PLAYERS: ProviderPlayerDTO[] = [
  {
    id: 'player-rohit',
    sport: Sport.CRICKET,
    teamProviderId: 'team-mi',
    name: 'Rohit Sharma',
    shortName: 'R. Sharma',
    role: PlayerRole.BATSMAN,
    position: 'Opener',
    country: 'IND',
    battingStyle: 'Right-handed',
    bowlingStyle: 'Right-arm offbreak',
    jerseyNumber: 45,
    dateOfBirth: '1987-04-30',
    photoUrl: null,
    isActive: true,
  },
  {
    id: 'player-bumrah',
    sport: Sport.CRICKET,
    teamProviderId: 'team-mi',
    name: 'Jasprit Bumrah',
    shortName: 'J. Bumrah',
    role: PlayerRole.BOWLER,
    position: 'Pacer',
    country: 'IND',
    battingStyle: 'Right-handed',
    bowlingStyle: 'Right-arm fast',
    jerseyNumber: 93,
    dateOfBirth: '1993-12-06',
    photoUrl: null,
    isActive: true,
  },
  {
    id: 'player-dhoni',
    sport: Sport.CRICKET,
    teamProviderId: 'team-csk',
    name: 'MS Dhoni',
    shortName: 'M. Dhoni',
    role: PlayerRole.WICKET_KEEPER,
    position: 'Finisher',
    country: 'IND',
    battingStyle: 'Right-handed',
    bowlingStyle: 'Right-arm medium',
    jerseyNumber: 7,
    dateOfBirth: '1981-07-07',
    photoUrl: null,
    isActive: true,
  },
  {
    id: 'player-kohli',
    sport: Sport.CRICKET,
    teamProviderId: 'team-rcb',
    name: 'Virat Kohli',
    shortName: 'V. Kohli',
    role: PlayerRole.BATSMAN,
    position: 'Top-order',
    country: 'IND',
    battingStyle: 'Right-handed',
    bowlingStyle: 'Right-arm medium',
    jerseyNumber: 18,
    dateOfBirth: '1988-11-05',
    photoUrl: null,
    isActive: true,
  },
  {
    id: 'player-cummins',
    sport: Sport.CRICKET,
    teamProviderId: 'team-aus',
    name: 'Pat Cummins',
    shortName: 'P. Cummins',
    role: PlayerRole.BOWLER,
    position: 'Pacer',
    country: 'AUS',
    battingStyle: 'Right-handed',
    bowlingStyle: 'Right-arm fast',
    jerseyNumber: 30,
    dateOfBirth: '1993-05-08',
    photoUrl: null,
    isActive: true,
  },
  {
    id: 'player-haaland',
    sport: Sport.FOOTBALL,
    teamProviderId: 'team-mci',
    name: 'Erling Haaland',
    shortName: 'E. Haaland',
    role: PlayerRole.FORWARD,
    position: 'Striker',
    country: 'NOR',
    battingStyle: null,
    bowlingStyle: null,
    jerseyNumber: 9,
    dateOfBirth: '2000-07-21',
    photoUrl: null,
    isActive: true,
  },
  // ─── MI extended squad (15) ───────────────────────────────────────────
  ...buildSquad('team-mi', 'IND', [
    { name: 'Ishan Kishan', short: 'I. Kishan', role: PlayerRole.WICKET_KEEPER, position: 'Opener' },
    { name: 'Suryakumar Yadav', short: 'S. Yadav', role: PlayerRole.BATSMAN, position: 'Top order' },
    { name: 'Tilak Varma', short: 'T. Varma', role: PlayerRole.BATSMAN, position: 'Middle order' },
    { name: 'Hardik Pandya', short: 'H. Pandya', role: PlayerRole.ALL_ROUNDER, position: 'Pace allrounder' },
    { name: 'Tim David', short: 'T. David', role: PlayerRole.BATSMAN, position: 'Finisher' },
    { name: 'Piyush Chawla', short: 'P. Chawla', role: PlayerRole.BOWLER, position: 'Leg-spin' },
    { name: 'Jason Behrendorff', short: 'J. Behrendorff', role: PlayerRole.BOWLER, position: 'Left-arm fast' },
    { name: 'Trent Boult', short: 'T. Boult', role: PlayerRole.BOWLER, position: 'Left-arm fast' },
    { name: 'Akash Madhwal', short: 'A. Madhwal', role: PlayerRole.BOWLER, position: 'Right-arm fast' },
    { name: 'Naman Dhir', short: 'N. Dhir', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
    { name: 'Anshul Kamboj', short: 'A. Kamboj', role: PlayerRole.BOWLER, position: 'Right-arm medium' },
    { name: 'Mitchell Santner', short: 'M. Santner', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
    { name: 'Will Jacks', short: 'W. Jacks', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
  ]),
  // ─── CSK extended squad (15) ──────────────────────────────────────────
  ...buildSquad('team-csk', 'IND', [
    { name: 'Ruturaj Gaikwad', short: 'R. Gaikwad', role: PlayerRole.BATSMAN, position: 'Opener' },
    { name: 'Devon Conway', short: 'D. Conway', role: PlayerRole.BATSMAN, position: 'Opener' },
    { name: 'Ravindra Jadeja', short: 'R. Jadeja', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
    { name: 'Shivam Dube', short: 'S. Dube', role: PlayerRole.ALL_ROUNDER, position: 'Pace allrounder' },
    { name: 'Ajinkya Rahane', short: 'A. Rahane', role: PlayerRole.BATSMAN, position: 'Top order' },
    { name: 'Moeen Ali', short: 'M. Ali', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
    { name: 'Deepak Chahar', short: 'D. Chahar', role: PlayerRole.BOWLER, position: 'Right-arm swing' },
    { name: 'Tushar Deshpande', short: 'T. Deshpande', role: PlayerRole.BOWLER, position: 'Right-arm fast' },
    { name: 'Maheesh Theekshana', short: 'M. Theekshana', role: PlayerRole.BOWLER, position: 'Off-spin' },
    { name: 'Mustafizur Rahman', short: 'M. Rahman', role: PlayerRole.BOWLER, position: 'Left-arm fast' },
    { name: 'Rachin Ravindra', short: 'R. Ravindra', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
    { name: 'Matheesha Pathirana', short: 'M. Pathirana', role: PlayerRole.BOWLER, position: 'Right-arm fast' },
    { name: 'Sameer Rizvi', short: 'S. Rizvi', role: PlayerRole.BATSMAN, position: 'Middle order' },
    { name: 'Daryl Mitchell', short: 'D. Mitchell', role: PlayerRole.BATSMAN, position: 'Middle order' },
  ]),
  // ─── RCB extended squad (15) ──────────────────────────────────────────
  ...buildSquad('team-rcb', 'IND', [
    { name: 'Faf du Plessis', short: 'F. du Plessis', role: PlayerRole.BATSMAN, position: 'Opener' },
    { name: 'Glenn Maxwell', short: 'G. Maxwell', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
    { name: 'Rajat Patidar', short: 'R. Patidar', role: PlayerRole.BATSMAN, position: 'Middle order' },
    { name: 'Dinesh Karthik', short: 'D. Karthik', role: PlayerRole.WICKET_KEEPER, position: 'Finisher' },
    { name: 'Cameron Green', short: 'C. Green', role: PlayerRole.ALL_ROUNDER, position: 'Pace allrounder' },
    { name: 'Anuj Rawat', short: 'A. Rawat', role: PlayerRole.WICKET_KEEPER, position: 'Top order' },
    { name: 'Mohammed Siraj', short: 'M. Siraj', role: PlayerRole.BOWLER, position: 'Right-arm fast' },
    { name: 'Yash Dayal', short: 'Y. Dayal', role: PlayerRole.BOWLER, position: 'Left-arm fast' },
    { name: 'Lockie Ferguson', short: 'L. Ferguson', role: PlayerRole.BOWLER, position: 'Right-arm fast' },
    { name: 'Karn Sharma', short: 'K. Sharma', role: PlayerRole.BOWLER, position: 'Leg-spin' },
    { name: 'Mayank Dagar', short: 'M. Dagar', role: PlayerRole.BOWLER, position: 'Left-arm orthodox' },
    { name: 'Swapnil Singh', short: 'S. Singh', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
    { name: 'Reece Topley', short: 'R. Topley', role: PlayerRole.BOWLER, position: 'Left-arm fast' },
    { name: 'Akash Deep', short: 'A. Deep', role: PlayerRole.BOWLER, position: 'Right-arm fast' },
  ]),
  // ─── IND men's T20 squad (15) ────────────────────────────────────────
  ...buildSquad('team-ind', 'IND', [
    { name: 'Yashasvi Jaiswal', short: 'Y. Jaiswal', role: PlayerRole.BATSMAN, position: 'Opener' },
    { name: 'Shubman Gill', short: 'S. Gill', role: PlayerRole.BATSMAN, position: 'Top order' },
    { name: 'Suryakumar Yadav', short: 'S. Yadav', role: PlayerRole.BATSMAN, position: 'Top order' },
    { name: 'Rishabh Pant', short: 'R. Pant', role: PlayerRole.WICKET_KEEPER, position: 'Middle order' },
    { name: 'Hardik Pandya', short: 'H. Pandya', role: PlayerRole.ALL_ROUNDER, position: 'Pace allrounder' },
    { name: 'Ravindra Jadeja', short: 'R. Jadeja', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
    { name: 'Axar Patel', short: 'A. Patel', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
    { name: 'Kuldeep Yadav', short: 'K. Yadav', role: PlayerRole.BOWLER, position: 'Left-arm wrist spin' },
    { name: 'Yuzvendra Chahal', short: 'Y. Chahal', role: PlayerRole.BOWLER, position: 'Leg-spin' },
    { name: 'Mohammed Siraj', short: 'M. Siraj', role: PlayerRole.BOWLER, position: 'Right-arm fast' },
    { name: 'Arshdeep Singh', short: 'A. Singh', role: PlayerRole.BOWLER, position: 'Left-arm fast' },
    { name: 'Shivam Dube', short: 'S. Dube', role: PlayerRole.ALL_ROUNDER, position: 'Pace allrounder' },
    { name: 'Sanju Samson', short: 'S. Samson', role: PlayerRole.WICKET_KEEPER, position: 'Top order' },
    { name: 'Rinku Singh', short: 'R. Singh', role: PlayerRole.BATSMAN, position: 'Finisher' },
  ]),
  // ─── AUS men's T20 squad (15) ────────────────────────────────────────
  ...buildSquad('team-aus', 'AUS', [
    { name: 'Travis Head', short: 'T. Head', role: PlayerRole.BATSMAN, position: 'Opener' },
    { name: 'Mitchell Marsh', short: 'M. Marsh', role: PlayerRole.ALL_ROUNDER, position: 'Pace allrounder' },
    { name: 'David Warner', short: 'D. Warner', role: PlayerRole.BATSMAN, position: 'Opener' },
    { name: 'Glenn Maxwell', short: 'G. Maxwell', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
    { name: 'Marcus Stoinis', short: 'M. Stoinis', role: PlayerRole.ALL_ROUNDER, position: 'Pace allrounder' },
    { name: 'Matthew Wade', short: 'M. Wade', role: PlayerRole.WICKET_KEEPER, position: 'Middle order' },
    { name: 'Josh Inglis', short: 'J. Inglis', role: PlayerRole.WICKET_KEEPER, position: 'Middle order' },
    { name: 'Tim David', short: 'T. David', role: PlayerRole.BATSMAN, position: 'Finisher' },
    { name: 'Mitchell Starc', short: 'M. Starc', role: PlayerRole.BOWLER, position: 'Left-arm fast' },
    { name: 'Josh Hazlewood', short: 'J. Hazlewood', role: PlayerRole.BOWLER, position: 'Right-arm fast' },
    { name: 'Adam Zampa', short: 'A. Zampa', role: PlayerRole.BOWLER, position: 'Leg-spin' },
    { name: 'Ashton Agar', short: 'A. Agar', role: PlayerRole.BOWLER, position: 'Left-arm orthodox' },
    { name: 'Nathan Ellis', short: 'N. Ellis', role: PlayerRole.BOWLER, position: 'Right-arm fast-medium' },
    { name: 'Spencer Johnson', short: 'S. Johnson', role: PlayerRole.BOWLER, position: 'Left-arm fast' },
  ]),
  // ─── ENG-W full squad (15) — mirrors the design reference ─────────────
  ...buildSquad('team-eng-w', 'ENG', [
    { name: 'Tammy Beaumont', short: 'T. Beaumont', role: PlayerRole.BATSMAN, position: 'Opener' },
    { name: 'Sophia Dunkley', short: 'S. Dunkley', role: PlayerRole.BATSMAN, position: 'Opener' },
    { name: 'Heather Knight', short: 'H. Knight', role: PlayerRole.BATSMAN, position: 'Top order' },
    { name: 'Nat Sciver-Brunt', short: 'N. Sciver', role: PlayerRole.ALL_ROUNDER, position: 'Middle order' },
    { name: 'Amy Jones', short: 'A. Jones', role: PlayerRole.WICKET_KEEPER, position: 'Keeper' },
    { name: 'Danni Wyatt', short: 'D. Wyatt', role: PlayerRole.BATSMAN, position: 'Middle order' },
    { name: 'Alice Capsey', short: 'A. Capsey', role: PlayerRole.BATSMAN, position: 'Middle order' },
    { name: 'Maia Bouchier', short: 'M. Bouchier', role: PlayerRole.BATSMAN, position: 'Middle order' },
    { name: 'Charlie Dean', short: 'C. Dean', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
    { name: 'Sophie Ecclestone', short: 'S. Ecclestone', role: PlayerRole.BOWLER, position: 'Left-arm orthodox' },
    { name: 'Lauren Bell', short: 'L. Bell', role: PlayerRole.BOWLER, position: 'Right-arm fast-medium' },
    { name: 'Linsey Smith', short: 'L. Smith', role: PlayerRole.BOWLER, position: 'Left-arm spin' },
    { name: 'Freya Kemp', short: 'F. Kemp', role: PlayerRole.ALL_ROUNDER, position: 'Pace allrounder' },
    { name: 'Issy Wong', short: 'I. Wong', role: PlayerRole.BOWLER, position: 'Right-arm fast' },
    { name: 'Danielle Gibson', short: 'D. Gibson', role: PlayerRole.ALL_ROUNDER, position: 'Pace allrounder' },
  ]),
  // ─── NZ-W full squad (15) ─────────────────────────────────────────────
  ...buildSquad('team-nz-w', 'NZL', [
    { name: 'Sophie Devine', short: 'S. Devine', role: PlayerRole.ALL_ROUNDER, position: 'Captain' },
    { name: 'Suzie Bates', short: 'S. Bates', role: PlayerRole.BATSMAN, position: 'Opener' },
    { name: 'Amelia Kerr', short: 'A. Kerr', role: PlayerRole.ALL_ROUNDER, position: 'Spin allrounder' },
    { name: 'Maddy Green', short: 'M. Green', role: PlayerRole.BATSMAN, position: 'Middle order' },
    { name: 'Brooke Halliday', short: 'B. Halliday', role: PlayerRole.ALL_ROUNDER, position: 'Pace allrounder' },
    { name: 'Georgia Plimmer', short: 'G. Plimmer', role: PlayerRole.BATSMAN, position: 'Opener' },
    { name: 'Izzy Gaze', short: 'I. Gaze', role: PlayerRole.WICKET_KEEPER, position: 'Keeper' },
    { name: 'Bernadine Bezuidenhout', short: 'B. Bezuidenhout', role: PlayerRole.WICKET_KEEPER, position: 'Keeper' },
    { name: 'Isabella Sharp', short: 'I. Sharp', role: PlayerRole.BATSMAN, position: 'Middle order' },
    { name: 'Jess Kerr', short: 'J. Kerr', role: PlayerRole.BOWLER, position: 'Right-arm medium' },
    { name: 'Nensi Patel', short: 'N. Patel', role: PlayerRole.BOWLER, position: 'Left-arm orthodox' },
    { name: 'Lea Tahuhu', short: 'L. Tahuhu', role: PlayerRole.BOWLER, position: 'Right-arm fast' },
    { name: 'Bree Illing', short: 'B. Illing', role: PlayerRole.BOWLER, position: 'Right-arm fast-medium' },
    { name: 'Eden Carson', short: 'E. Carson', role: PlayerRole.BOWLER, position: 'Off-spin' },
    { name: 'Fran Jonas', short: 'F. Jonas', role: PlayerRole.BOWLER, position: 'Left-arm orthodox' },
  ]),
];

/**
 * Compact roster builder — fills in repetitive fields (jersey numbers,
 * batting / bowling style placeholders) so the static catalogue stays
 * readable. Credits are NOT set here — they default to
 * `AppConstants.FANTASY.DEFAULT_PLAYER_BASE_CREDITS` on the model.
 *
 * Declared as a `function` (not a `const` arrow) so it is hoisted to
 * the top of the module — the `MOCK_PLAYERS` literal above invokes
 * this helper at module-evaluation time.
 */
function buildSquad(
  teamProviderId: string,
  country: string,
  roster: Array<{ name: string; short: string; role: PlayerRole; position: string }>,
): ProviderPlayerDTO[] {
  return roster.map((p, idx) => ({
    id: `${teamProviderId}-${slug(p.name)}`,
    sport: Sport.CRICKET,
    teamProviderId,
    name: p.name,
    shortName: p.short,
    role: p.role,
    position: p.position,
    country,
    battingStyle: 'Right-handed',
    bowlingStyle:
      p.role === PlayerRole.BOWLER || p.role === PlayerRole.ALL_ROUNDER
        ? 'Right-arm'
        : null,
    jerseyNumber: idx + 1,
    dateOfBirth: null,
    photoUrl: null,
    isActive: true,
  }));
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Generates a deterministic-ish slate of matches around `now`.
 *
 * Bucketed by 5-min epochs so consecutive calls inside the same window
 * return the same matches (idempotent ingestion). When a new window
 * starts the live match shifts forward — exercises the LIVE → COMPLETED
 * transition path without flakiness in tests.
 */
const generateMatches = (): ProviderMatchDTO[] => {
  const now = new Date();
  const baseEpoch = Math.floor(now.getTime() / (5 * 60_000)) * 5 * 60_000;

  const at = (offsetMin: number): string =>
    new Date(baseEpoch + offsetMin * 60_000).toISOString();

  const matches: ProviderMatchDTO[] = [
    // LIVE — IPL final-ish in progress
    {
      id: 'match-mi-csk-live',
      sport: Sport.CRICKET,
      format: MatchFormat.T20,
      tournamentProviderId: 'tour-ipl-2026',
      homeTeamProviderId: 'team-mi',
      awayTeamProviderId: 'team-csk',
      status: MatchStatus.LIVE,
      scheduledAt: at(-40),
      startedAt: at(-35),
      completedAt: null,
      venue: { name: 'Wankhede Stadium', city: 'Mumbai', country: 'IND' },
      scores: [
        { teamProviderId: 'team-mi', score: 152, secondary: 4, overs: '17.2' },
        { teamProviderId: 'team-csk', score: 0, secondary: 0, overs: '0.0' },
      ],
      resultSummary: null,
      winnerTeamProviderId: null,
      tossWinnerTeamProviderId: 'team-mi',
      tossDecision: 'BAT',
    },
    // UPCOMING — tonight
    {
      id: 'match-rcb-csk-tonight',
      sport: Sport.CRICKET,
      format: MatchFormat.T20,
      tournamentProviderId: 'tour-ipl-2026',
      homeTeamProviderId: 'team-rcb',
      awayTeamProviderId: 'team-csk',
      status: MatchStatus.UPCOMING,
      scheduledAt: at(45),
      startedAt: null,
      completedAt: null,
      venue: { name: 'M Chinnaswamy Stadium', city: 'Bengaluru', country: 'IND' },
      scores: [],
      resultSummary: null,
      winnerTeamProviderId: null,
      tossWinnerTeamProviderId: null,
      tossDecision: null,
    },
    // UPCOMING — tomorrow
    {
      id: 'match-mi-rcb-tomorrow',
      sport: Sport.CRICKET,
      format: MatchFormat.T20,
      tournamentProviderId: 'tour-ipl-2026',
      homeTeamProviderId: 'team-mi',
      awayTeamProviderId: 'team-rcb',
      status: MatchStatus.UPCOMING,
      scheduledAt: at(60 * 24),
      startedAt: null,
      completedAt: null,
      venue: { name: 'Wankhede Stadium', city: 'Mumbai', country: 'IND' },
      scores: [],
      resultSummary: null,
      winnerTeamProviderId: null,
      tossWinnerTeamProviderId: null,
      tossDecision: null,
    },
    // UPCOMING — World Cup
    {
      id: 'match-ind-aus-wc',
      sport: Sport.CRICKET,
      format: MatchFormat.T20,
      tournamentProviderId: 'tour-wt20-2026',
      homeTeamProviderId: 'team-ind',
      awayTeamProviderId: 'team-aus',
      status: MatchStatus.UPCOMING,
      scheduledAt: at(60 * 24 * 3),
      startedAt: null,
      completedAt: null,
      venue: { name: 'Eden Gardens', city: 'Kolkata', country: 'IND' },
      scores: [],
      resultSummary: null,
      winnerTeamProviderId: null,
      tossWinnerTeamProviderId: null,
      tossDecision: null,
    },
    // COMPLETED — historical
    {
      id: 'match-mi-csk-completed',
      sport: Sport.CRICKET,
      format: MatchFormat.T20,
      tournamentProviderId: 'tour-ipl-2026',
      homeTeamProviderId: 'team-mi',
      awayTeamProviderId: 'team-csk',
      status: MatchStatus.COMPLETED,
      scheduledAt: at(-60 * 24 * 2),
      startedAt: at(-60 * 24 * 2 + 5),
      completedAt: at(-60 * 24 * 2 + 240),
      venue: { name: 'Wankhede Stadium', city: 'Mumbai', country: 'IND' },
      scores: [
        { teamProviderId: 'team-mi', score: 198, secondary: 6, overs: '20.0' },
        { teamProviderId: 'team-csk', score: 174, secondary: 8, overs: '20.0' },
      ],
      resultSummary: 'Mumbai Indians won by 24 runs',
      winnerTeamProviderId: 'team-mi',
      tossWinnerTeamProviderId: 'team-csk',
      tossDecision: 'BOWL',
    },
    // WOMEN'S T20I — design reference fixture (ENG-W vs NZ-W)
    {
      id: 'match-engw-nzw-tonight',
      sport: Sport.CRICKET,
      format: MatchFormat.T20,
      tournamentProviderId: 'tour-women-bilateral-2026',
      homeTeamProviderId: 'team-eng-w',
      awayTeamProviderId: 'team-nz-w',
      status: MatchStatus.UPCOMING,
      scheduledAt: at(60 * 4),
      startedAt: null,
      completedAt: null,
      venue: { name: "Lord's Cricket Ground", city: 'London', country: 'ENG' },
      scores: [],
      resultSummary: null,
      winnerTeamProviderId: null,
      tossWinnerTeamProviderId: null,
      tossDecision: null,
    },
    // FOOTBALL UPCOMING
    {
      id: 'match-mci-mun-weekend',
      sport: Sport.FOOTBALL,
      format: MatchFormat.LEAGUE,
      tournamentProviderId: 'tour-epl-2526',
      homeTeamProviderId: 'team-mci',
      awayTeamProviderId: 'team-mun',
      status: MatchStatus.UPCOMING,
      scheduledAt: at(60 * 36),
      startedAt: null,
      completedAt: null,
      venue: { name: 'Etihad Stadium', city: 'Manchester', country: 'ENG' },
      scores: [],
      resultSummary: null,
      winnerTeamProviderId: null,
      tossWinnerTeamProviderId: null,
      tossDecision: null,
    },
  ];

  return matches;
};

export const mockSportsProvider = new MockSportsProvider();
export { MockSportsProvider };

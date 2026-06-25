import { PlayerRole } from '@common/enums';

import { DEFAULT_PLAYER_CREDITS } from './constants.fixture';

export interface SquadPlayerSpec {
  name: string;
  role: PlayerRole;
  baseCredits?: number;
}

/** Role distribution for a valid 11-player cricket T20 squad. */
export const CRICKET_T20_ROLE_DISTRIBUTION: PlayerRole[] = [
  PlayerRole.WICKET_KEEPER,
  PlayerRole.BATSMAN,
  PlayerRole.BATSMAN,
  PlayerRole.BATSMAN,
  PlayerRole.BATSMAN,
  PlayerRole.ALL_ROUNDER,
  PlayerRole.ALL_ROUNDER,
  PlayerRole.BOWLER,
  PlayerRole.BOWLER,
  PlayerRole.BOWLER,
  PlayerRole.BOWLER,
];

export const buildHomeSquadSpecs = (): SquadPlayerSpec[] =>
  CRICKET_T20_ROLE_DISTRIBUTION.slice(0, 6).map((role, index) => ({
    name: `Home Player ${index + 1}`,
    role,
    baseCredits: DEFAULT_PLAYER_CREDITS,
  }));

export const buildAwaySquadSpecs = (): SquadPlayerSpec[] =>
  CRICKET_T20_ROLE_DISTRIBUTION.slice(6).map((role, index) => ({
    name: `Away Player ${index + 1}`,
    role,
    baseCredits: DEFAULT_PLAYER_CREDITS,
  }));

export interface TeamPlayerSelection {
  playerId: string;
  isCaptain: boolean;
  isViceCaptain: boolean;
}

/**
 * Build a valid 11-player payload from seeded player ids.
 * Uses 6 home + 5 away players to satisfy min/max-from-single-team rules.
 */
export const buildValidTeamPlayers = (
  homePlayerIds: string[],
  awayPlayerIds: string[],
): TeamPlayerSelection[] => {
  const selected = [...homePlayerIds.slice(0, 6), ...awayPlayerIds.slice(0, 5)];

  return selected.map((playerId, index) => ({
    playerId,
    isCaptain: index === 0,
    isViceCaptain: index === 1,
  }));
};

/** Intentionally invalid payload — only 3 players. */
export const buildInvalidTeamPlayers = (playerIds: string[]): TeamPlayerSelection[] =>
  playerIds.slice(0, 3).map((playerId, index) => ({
    playerId,
    isCaptain: index === 0,
    isViceCaptain: index === 1,
  }));

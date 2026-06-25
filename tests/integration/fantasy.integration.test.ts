import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@common/constants';

import { buildInvalidTeamPlayers, buildValidTeamPlayers } from '../fixtures/cricket-squad.fixture';
import { getAgent } from '../helpers/api.client';
import { authHeader, signupViaApi } from '../helpers/auth.helper';
import { expectFailure, expectSuccess } from '../helpers/response.helper';
import { seedTestWorld } from '../helpers/seed.helper';

describe('Fantasy team integration', () => {
  const agent = getAgent();

  describe('POST /api/v1/fantasy/teams', () => {
    it('creates a valid fantasy team for an upcoming match', async () => {
      const world = await seedTestWorld();
      const user = await signupViaApi(agent);

      const players = buildValidTeamPlayers(
        world.homePlayers.map((p) => String(p._id)),
        world.awayPlayers.map((p) => String(p._id)),
      );

      const res = await agent
        .post('/api/v1/fantasy/teams')
        .set(authHeader(user.tokens.accessToken))
        .send({
          matchId: world.matchId,
          name: 'My Integration XI',
          players,
        });

      const { data } = expectSuccess<{
        id: string;
        name: string;
        players: unknown[];
        matchId: string;
      }>(res, 201);

      expect(data.name).toBe('My Integration XI');
      expect(data.matchId).toBe(world.matchId);
      expect(data.players).toHaveLength(11);
    });

    it('returns validation failure when team size is wrong', async () => {
      const world = await seedTestWorld();
      const user = await signupViaApi(agent);

      const allIds = world.players.map((p) => String(p._id));
      const players = buildInvalidTeamPlayers(allIds);

      const res = await agent
        .post('/api/v1/fantasy/teams')
        .set(authHeader(user.tokens.accessToken))
        .send({
          matchId: world.matchId,
          players,
        });

      expectFailure(res, 422, ErrorCode.FANTASY_TEAM_INVALID);
    });
  });

  describe('PATCH /api/v1/fantasy/teams/:teamId', () => {
    it('updates team name and player selections', async () => {
      const world = await seedTestWorld();
      const user = await signupViaApi(agent);

      const players = buildValidTeamPlayers(
        world.homePlayers.map((p) => String(p._id)),
        world.awayPlayers.map((p) => String(p._id)),
      );

      const createRes = await agent
        .post('/api/v1/fantasy/teams')
        .set(authHeader(user.tokens.accessToken))
        .send({ matchId: world.matchId, players });

      const { data: created } = expectSuccess<{ id: string }>(createRes, 201);

      const swappedPlayers = players.map((player, index) => ({
        ...player,
        isCaptain: index === 3,
        isViceCaptain: index === 1,
      }));

      const updateRes = await agent
        .patch(`/api/v1/fantasy/teams/${created.id}`)
        .set(authHeader(user.tokens.accessToken))
        .send({
          name: 'Updated Integration XI',
          players: swappedPlayers,
        });

      const { data: updated } = expectSuccess<{ name: string }>(updateRes, 200);
      expect(updated.name).toBe('Updated Integration XI');
    });
  });
});

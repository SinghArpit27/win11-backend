import { describe, expect, it } from 'vitest';

import { buildValidTeamPlayers } from '../fixtures/cricket-squad.fixture';
import { uniqueIdempotencyKey } from '../generators/mock-data.generator';
import { getAgent } from '../helpers/api.client';
import { authHeader, signupViaApi } from '../helpers/auth.helper';
import { expectSuccess } from '../helpers/response.helper';
import { seedTestWorld } from '../helpers/seed.helper';

describe('Leaderboard integration', () => {
  const agent = getAgent();

  const joinPracticeContest = async (): Promise<{
    user: Awaited<ReturnType<typeof signupViaApi>>;
    contestId: string;
    entryId: string;
  }> => {
    const world = await seedTestWorld();
    const user = await signupViaApi(agent);

    const players = buildValidTeamPlayers(
      world.homePlayers.map((p) => String(p._id)),
      world.awayPlayers.map((p) => String(p._id)),
    );

    const teamRes = await agent
      .post('/api/v1/fantasy/teams')
      .set(authHeader(user.tokens.accessToken))
      .send({ matchId: world.matchId, players });

    const { data: teamData } = expectSuccess<{ id: string }>(teamRes, 201);
    const contestId = String(world.practiceContest._id);

    const joinRes = await agent
      .post(`/api/v1/contests/${contestId}/join`)
      .set(authHeader(user.tokens.accessToken))
      .send({ teamId: teamData.id, idempotencyKey: uniqueIdempotencyKey() });

    const { data: joinData } = expectSuccess<{ entry: { id: string } }>(joinRes, 201);

    return { user, contestId, entryId: joinData.entry.id };
  };

  describe('leaderboard creation on contest join', () => {
    it('registers an entry on the contest leaderboard after join', async () => {
      const { user, contestId, entryId } = await joinPracticeContest();

      const res = await agent
        .get(`/api/v1/leaderboard/contests/${contestId}`)
        .set(authHeader(user.tokens.accessToken));

      const { data } = expectSuccess<{
        rows: Array<{ entryId: string; rank: number; points: number }>;
        totalEntries: number;
      }>(res, 200);

      expect(data.totalEntries).toBe(1);
      expect(data.rows).toHaveLength(1);
      expect(data.rows[0]?.entryId).toBe(entryId);
      expect(data.rows[0]?.rank).toBe(1);
      expect(data.rows[0]?.points).toBe(0);
    });
  });

  describe('GET /api/v1/leaderboard/contests/:contestId/me', () => {
    it('marks the caller on the paginated leaderboard when Redis is disabled', async () => {
      const { user, contestId } = await joinPracticeContest();

      const res = await agent
        .get(`/api/v1/leaderboard/contests/${contestId}`)
        .set(authHeader(user.tokens.accessToken));

      const { data } = expectSuccess<{
        rows: Array<{ rank: number; isCurrentUser: boolean }>;
        totalEntries: number;
      }>(res, 200);

      const myRow = data.rows.find((row) => row.isCurrentUser);
      expect(myRow?.rank).toBe(1);
      expect(data.totalEntries).toBe(1);
    });
  });

  describe('ranking validation', () => {
    it('assigns distinct ranks to two entries at equal points', async () => {
      const world = await seedTestWorld();
      const contestId = String(world.practiceContest._id);

      const joinAsUser = async (): Promise<string> => {
        const user = await signupViaApi(agent);
        const players = buildValidTeamPlayers(
          world.homePlayers.map((p) => String(p._id)),
          world.awayPlayers.map((p) => String(p._id)),
        );

        const teamRes = await agent
          .post('/api/v1/fantasy/teams')
          .set(authHeader(user.tokens.accessToken))
          .send({ matchId: world.matchId, players });

        const { data: teamData } = expectSuccess<{ id: string }>(teamRes, 201);

        const joinRes = await agent
          .post(`/api/v1/contests/${contestId}/join`)
          .set(authHeader(user.tokens.accessToken))
          .send({ teamId: teamData.id, idempotencyKey: uniqueIdempotencyKey() });

        const { data: joinData } = expectSuccess<{ entry: { id: string } }>(joinRes, 201);
        return joinData.entry.id;
      };

      const firstEntryId = await joinAsUser();
      const secondEntryId = await joinAsUser();

      const res = await agent.get(`/api/v1/leaderboard/contests/${contestId}`);
      const { data } = expectSuccess<{
        rows: Array<{ entryId: string; rank: number }>;
        totalEntries: number;
      }>(res, 200);

      expect(data.totalEntries).toBe(2);
      expect(data.rows.map((row) => row.rank).sort()).toEqual([1, 2]);
      expect(data.rows.map((row) => row.entryId).sort()).toEqual(
        [firstEntryId, secondEntryId].sort(),
      );
    });
  });
});

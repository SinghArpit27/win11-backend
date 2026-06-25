import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@common/constants';

import { buildValidTeamPlayers } from '../fixtures/cricket-squad.fixture';
import { MIN_DEPOSIT_MAJOR } from '../fixtures/constants.fixture';
import { uniqueIdempotencyKey } from '../generators/mock-data.generator';
import { getAgent } from '../helpers/api.client';
import {
  authHeader,
  idempotencyHeader,
  signupViaApi,
} from '../helpers/auth.helper';
import { expectFailure, expectSuccess } from '../helpers/response.helper';
import { seedTestWorld } from '../helpers/seed.helper';

describe('Contest integration', () => {
  const agent = getAgent();

  const createTeamForWorld = async (
    accessToken: string,
    world: Awaited<ReturnType<typeof seedTestWorld>>,
  ): Promise<string> => {
    const players = buildValidTeamPlayers(
      world.homePlayers.map((p) => String(p._id)),
      world.awayPlayers.map((p) => String(p._id)),
    );

    const res = await agent
      .post('/api/v1/fantasy/teams')
      .set(authHeader(accessToken))
      .send({ matchId: world.matchId, players });

    const { data } = expectSuccess<{ id: string }>(res, 201);
    return data.id;
  };

  describe('GET /api/v1/contests', () => {
    it('lists contests for a match', async () => {
      const world = await seedTestWorld();

      const res = await agent.get('/api/v1/contests').query({
        matchId: world.matchId,
      });

      const { data } = expectSuccess<Array<{ id: string; name: string; matchId: string }>>(res, 200);

      expect(data.length).toBeGreaterThanOrEqual(2);
      expect(data.every((c) => c.matchId === world.matchId)).toBe(true);
    });
  });

  describe('GET /api/v1/contests/:contestId', () => {
    it('returns contest details', async () => {
      const world = await seedTestWorld();

      const res = await agent.get(`/api/v1/contests/${String(world.practiceContest._id)}`);
      const { data } = expectSuccess<{ id: string; name: string; entryFee: number }>(res, 200);

      expect(data.id).toBe(String(world.practiceContest._id));
      expect(data.entryFee).toBe(0);
      expect(data.name).toContain('Practice');
    });
  });

  describe('POST /api/v1/contests/:contestId/join', () => {
    it('joins a practice contest with a valid team', async () => {
      const world = await seedTestWorld();
      const user = await signupViaApi(agent);
      const teamId = await createTeamForWorld(user.tokens.accessToken, world);

      const res = await agent
        .post(`/api/v1/contests/${String(world.practiceContest._id)}/join`)
        .set(authHeader(user.tokens.accessToken))
        .send({ teamId, idempotencyKey: uniqueIdempotencyKey() });

      const { data } = expectSuccess<{
        entry: { id: string; contestId: string; teamId: string; status: string };
        contest: { filledSpots: number };
      }>(res, 201);

      expect(data.entry.contestId).toBe(String(world.practiceContest._id));
      expect(data.entry.teamId).toBe(teamId);
      expect(data.entry.status).toBe('ACTIVE');
      expect(data.contest.filledSpots).toBe(1);
    });

    it('prevents duplicate join with the same team', async () => {
      const world = await seedTestWorld();
      const user = await signupViaApi(agent);
      const teamId = await createTeamForWorld(user.tokens.accessToken, world);
      const contestId = String(world.practiceContest._id);

      await agent
        .post(`/api/v1/contests/${contestId}/join`)
        .set(authHeader(user.tokens.accessToken))
        .send({ teamId, idempotencyKey: uniqueIdempotencyKey() });

      const duplicateRes = await agent
        .post(`/api/v1/contests/${contestId}/join`)
        .set(authHeader(user.tokens.accessToken))
        .send({ teamId, idempotencyKey: uniqueIdempotencyKey() });

      expectFailure(duplicateRes, 422, ErrorCode.CONTEST_TEAM_ALREADY_JOINED);
    });

    it('rejects join when wallet balance is insufficient for paid contests', async () => {
      const world = await seedTestWorld();
      const user = await signupViaApi(agent);
      const teamId = await createTeamForWorld(user.tokens.accessToken, world);

      const res = await agent
        .post(`/api/v1/contests/${String(world.paidContest._id)}/join`)
        .set(authHeader(user.tokens.accessToken))
        .send({ teamId, idempotencyKey: uniqueIdempotencyKey() });

      expectFailure(res, 422, ErrorCode.WALLET_INSUFFICIENT_BALANCE);
    });

    it('joins a paid contest after depositing funds', async () => {
      const world = await seedTestWorld();
      const user = await signupViaApi(agent);
      const teamId = await createTeamForWorld(user.tokens.accessToken, world);

      await agent
        .post('/api/v1/wallets/me/deposit')
        .set(authHeader(user.tokens.accessToken))
        .set(idempotencyHeader(uniqueIdempotencyKey()))
        .send({ amount: MIN_DEPOSIT_MAJOR, currency: 'INR' });

      const res = await agent
        .post(`/api/v1/contests/${String(world.paidContest._id)}/join`)
        .set(authHeader(user.tokens.accessToken))
        .send({ teamId, idempotencyKey: uniqueIdempotencyKey() });

      const { data } = expectSuccess<{
        entry: { id: string };
        wallet: { spendable: number; locked: number };
      }>(res, 201);

      expect(data.entry.id).toBeTruthy();
      expect(data.wallet.locked).toBeGreaterThanOrEqual(world.paidContest.entryFee);
    });
  });
});

import { describe, expect, it } from 'vitest';

import { buildValidTeamPlayers } from '../fixtures/cricket-squad.fixture';
import { MIN_DEPOSIT_MAJOR } from '../fixtures/constants.fixture';
import { uniqueIdempotencyKey } from '../generators/mock-data.generator';
import { getAgent } from '../helpers/api.client';
import {
  authHeader,
  idempotencyHeader,
  loginViaApi,
  signupViaApi,
} from '../helpers/auth.helper';
import { expectSuccess } from '../helpers/response.helper';
import { seedTestWorld } from '../helpers/seed.helper';

describe('End-to-end user journey', () => {
  const agent = getAgent();

  it('Signup → Login → Create Team → Join Contest → Wallet Debited → Leaderboard → My Contests', async () => {
    const world = await seedTestWorld();

    // 1. Signup
    const signupUser = await signupViaApi(agent);
    expect(signupUser.tokens.accessToken).toBeTruthy();

    // 2. Login
    const loginTokens = await loginViaApi(agent, signupUser.email, signupUser.password);
    expect(loginTokens.accessToken).toBeTruthy();

    // 3. Deposit wallet for paid contest entry
    const depositRes = await agent
      .post('/api/v1/wallets/me/deposit')
      .set(authHeader(loginTokens.accessToken))
      .set(idempotencyHeader(uniqueIdempotencyKey()))
      .send({ amount: MIN_DEPOSIT_MAJOR, currency: 'INR' });

    const { data: depositData } = expectSuccess<{
      wallet: { balances: { spendable: number } };
    }>(depositRes, 201);

    const spendableAfterDeposit = depositData.wallet.balances.spendable;
    expect(spendableAfterDeposit).toBe(MIN_DEPOSIT_MAJOR * 100);

    // 4. Create fantasy team
    const players = buildValidTeamPlayers(
      world.homePlayers.map((p) => String(p._id)),
      world.awayPlayers.map((p) => String(p._id)),
    );

    const teamRes = await agent
      .post('/api/v1/fantasy/teams')
      .set(authHeader(loginTokens.accessToken))
      .send({
        matchId: world.matchId,
        name: 'E2E Journey XI',
        players,
      });

    const { data: teamData } = expectSuccess<{ id: string }>(teamRes, 201);

    // 5. Join paid contest
    const contestId = String(world.paidContest._id);
    const joinRes = await agent
      .post(`/api/v1/contests/${contestId}/join`)
      .set(authHeader(loginTokens.accessToken))
      .send({
        teamId: teamData.id,
        idempotencyKey: uniqueIdempotencyKey(),
      });

    const { data: joinData } = expectSuccess<{
      entry: { id: string; contestId: string; status: string };
      wallet: { spendable: number; locked: number };
    }>(joinRes, 201);

    // 6. Wallet debited (entry fee locked)
    expect(joinData.entry.status).toBe('ACTIVE');
    expect(joinData.wallet.locked).toBeGreaterThanOrEqual(world.paidContest.entryFee);
    expect(joinData.wallet.spendable).toBeLessThan(spendableAfterDeposit);

    // 7. Leaderboard entry created
    const leaderboardRes = await agent
      .get(`/api/v1/leaderboard/contests/${contestId}`)
      .set(authHeader(loginTokens.accessToken));

    const { data: leaderboard } = expectSuccess<{
      rows: Array<{ entryId: string; rank: number }>;
      totalEntries: number;
    }>(leaderboardRes, 200);

    expect(leaderboard.totalEntries).toBe(1);
    expect(leaderboard.rows[0]?.entryId).toBe(joinData.entry.id);
    expect(leaderboard.rows[0]?.rank).toBe(1);

    const myRankRes = await agent
      .get(`/api/v1/leaderboard/contests/${contestId}`)
      .set(authHeader(loginTokens.accessToken));

    const { data: myRankPage } = expectSuccess<{
      rows: Array<{ rank: number; isCurrentUser: boolean }>;
      totalEntries: number;
    }>(myRankRes, 200);
    expect(myRankPage.rows.find((row) => row.isCurrentUser)?.rank).toBe(1);
    expect(myRankPage.totalEntries).toBe(1);

    // 8. My contests visible
    const myContestsRes = await agent
      .get('/api/v1/contests/entries')
      .set(authHeader(loginTokens.accessToken));

    const { data: myContests, meta } = expectSuccess<
      Array<{ contestId: string; id: string }>
    >(myContestsRes, 200);

    const pagination = meta as { total?: number } | undefined;
    expect(pagination?.total ?? myContests.length).toBeGreaterThanOrEqual(1);
    expect(myContests.some((entry) => entry.contestId === contestId)).toBe(true);
    expect(myContests.some((entry) => entry.id === joinData.entry.id)).toBe(true);
  });
});

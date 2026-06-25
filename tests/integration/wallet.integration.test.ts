import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@common/constants';

import { MIN_DEPOSIT_MAJOR } from '../fixtures/constants.fixture';
import { uniqueIdempotencyKey } from '../generators/mock-data.generator';
import { getAgent } from '../helpers/api.client';
import { authHeader, idempotencyHeader, signupViaApi } from '../helpers/auth.helper';
import { expectFailure, expectSuccess } from '../helpers/response.helper';

describe('Wallet integration', () => {
  const agent = getAgent();

  describe('GET /api/v1/wallets/me', () => {
    it('auto-provisions a wallet on signup', async () => {
      const user = await signupViaApi(agent);

      const res = await agent.get('/api/v1/wallets/me').set(authHeader(user.tokens.accessToken));
      const { data } = expectSuccess<{ wallet: { balances: { spendable: number } } }>(res, 200);

      expect(data.wallet.balances.spendable).toBe(0);
    });
  });

  describe('POST /api/v1/wallets/me/deposit', () => {
    it('credits the wallet and records a transaction', async () => {
      const user = await signupViaApi(agent);
      const depositMajor = MIN_DEPOSIT_MAJOR;

      const depositRes = await agent
        .post('/api/v1/wallets/me/deposit')
        .set(authHeader(user.tokens.accessToken))
        .set(idempotencyHeader(uniqueIdempotencyKey()))
        .send({ amount: depositMajor, currency: 'INR', description: 'Test deposit' });

      const { data: depositData } = expectSuccess<{
        wallet: { balances: { spendable: number; deposit: number } };
        transaction: { amount: number; type: string };
      }>(depositRes, 201);

      expect(depositData.wallet.balances.spendable).toBe(depositMajor * 100);
      expect(depositData.transaction.amount).toBe(depositMajor * 100);
      expect(depositData.transaction.type).toBe('DEPOSIT');

      const historyRes = await agent
        .get('/api/v1/wallets/me/transactions')
        .set(authHeader(user.tokens.accessToken));

      const { data: history, meta } = expectSuccess<
        Array<{ type: string; amount: number }>
      >(historyRes, 200);

      const pagination = meta as { total?: number } | undefined;
      expect(pagination?.total ?? history.length).toBeGreaterThanOrEqual(1);
      expect(history[0]?.type).toBe('DEPOSIT');
      expect(history[0]?.amount).toBe(depositMajor * 100);
    });

    it('requires an idempotency key header', async () => {
      const user = await signupViaApi(agent);

      const res = await agent
        .post('/api/v1/wallets/me/deposit')
        .set(authHeader(user.tokens.accessToken))
        .send({ amount: MIN_DEPOSIT_MAJOR, currency: 'INR' });

      expectFailure(res, 400, ErrorCode.IDEMPOTENCY_KEY_REQUIRED);
    });
  });

  describe('insufficient balance', () => {
    it('rejects withdrawal above spendable balance', async () => {
      const user = await signupViaApi(agent);
      const withdrawMajor = 100;

      const res = await agent
        .post('/api/v1/wallets/me/withdraw')
        .set(authHeader(user.tokens.accessToken))
        .set(idempotencyHeader(uniqueIdempotencyKey()))
        .send({ amount: withdrawMajor, currency: 'INR' });

      expectFailure(res, 400, ErrorCode.WALLET_INSUFFICIENT_BALANCE);
    });
  });
});

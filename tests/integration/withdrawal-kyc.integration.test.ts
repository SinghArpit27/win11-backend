import { describe, expect, it } from 'vitest';

import { KycStatus, WithdrawalStatus } from '@common/enums';

import { kycService } from '@modules/kyc/kyc.service';
import { withdrawalService } from '@modules/withdrawals/withdrawal.service';
import { walletService } from '@modules/wallet/wallet.service';

import { MIN_DEPOSIT_MAJOR } from '../fixtures/constants.fixture';
import { uniqueIdempotencyKey } from '../generators/mock-data.generator';
import { getAgent } from '../helpers/api.client';
import { authHeader, idempotencyHeader, signupViaApi } from '../helpers/auth.helper';
import { expectSuccess } from '../helpers/response.helper';

describe('Withdrawal settlement flow', () => {
  const agent = getAgent();

  it('approves withdrawal after KYC and debits locked funds', async () => {
    const user = await signupViaApi(agent);

    await kycService.submitProfile(user.userId, { fullName: 'Test User' });
    const profile = await kycService.getOrCreateProfile(user.userId);
    await kycService.approve(String(profile._id), user.userId);

    await agent
      .post('/api/v1/wallets/me/deposit')
      .set(authHeader(user.tokens.accessToken))
      .set(idempotencyHeader(uniqueIdempotencyKey()))
      .send({ amount: MIN_DEPOSIT_MAJOR, currency: 'INR' });

    const walletBefore = await walletService.getWalletSnapshot(user.userId);
    const withdrawAmountMinor = 500;

    const withdrawal = await withdrawalService.requestWithdrawal({
      userId: user.userId,
      amount: withdrawAmountMinor,
      currency: 'INR',
      idempotencyKey: uniqueIdempotencyKey(),
      upiId: 'test@upi',
    });

    expect(withdrawal.status).toBe(WithdrawalStatus.UNDER_REVIEW);

    const walletLocked = await walletService.getWalletSnapshot(user.userId);
    expect(walletLocked.balances.spendable).toBeLessThan(walletBefore.balances.spendable);

    await withdrawalService.approve(String(withdrawal._id), user.userId);

    const updated = await withdrawalService.listForUser(user.userId, { page: 1, limit: 1 });
    expect(updated.items[0]?.status).toBe(WithdrawalStatus.COMPLETED);

    const walletAfter = await walletService.getWalletSnapshot(user.userId);
    expect(walletAfter.balances.spendable).toBe(walletBefore.balances.spendable - withdrawAmountMinor);
  });
});

describe('KYC workflow', () => {
  it('transitions profile through submit and approve', async () => {
    const user = await signupViaApi(getAgent());
    const submitted = await kycService.submitProfile(user.userId, {
      fullName: 'Integration KYC User',
      panNumber: 'ABCDE1234F',
    });

    expect(submitted.status).toBe(KycStatus.UNDER_REVIEW);

    const approved = await kycService.approve(String(submitted._id), user.userId);
    expect(approved.status).toBe(KycStatus.APPROVED);
  });
});

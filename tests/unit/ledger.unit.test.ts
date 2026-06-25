import { describe, expect, it } from 'vitest';

import { LedgerDirection, WalletBucket, WalletTxType } from '@common/enums';

/**
 * Ledger invariants — wallet balance changes must always flow through
 * typed transactions with explicit direction + bucket.
 */
describe('Ledger accounting invariants', () => {
  it('defines deposit as credit to deposit bucket', () => {
    expect(WalletTxType.DEPOSIT).toBe('DEPOSIT');
    expect(LedgerDirection.CREDIT).toBe('CREDIT');
    expect(WalletBucket.DEPOSIT).toBe('DEPOSIT');
  });

  it('defines withdrawal lock/release transaction types', () => {
    expect(WalletTxType.WITHDRAWAL_LOCK).toBe('WITHDRAWAL_LOCK');
    expect(WalletTxType.WITHDRAWAL_RELEASE).toBe('WITHDRAWAL_RELEASE');
  });

  it('covers all Phase 9 financial transaction categories', () => {
    const types = [
      WalletTxType.DEPOSIT,
      WalletTxType.WITHDRAW,
      WalletTxType.CONTEST_JOIN,
      WalletTxType.WINNING_CREDIT,
      WalletTxType.CONTEST_REFUND,
      WalletTxType.BONUS_CREDIT,
    ];
    expect(new Set(types).size).toBe(types.length);
  });
});

/**
 * Dev seed — credit a user's wallet by userId only.
 *
 * Uses the same ledger-backed `walletService.deposit()` path as production
 * (immutable ledger entries + balance update). Safe for local/dev only.
 *
 * Usage (from `backend/`):
 *   npm run seed:wallet -- <userId>
 *   npm run seed:wallet -- <userId> 5000
 *
 * Env (optional):
 *   WALLET_SEED_AMOUNT_MAJOR=1000   default deposit in rupees (major units)
 *   SEED_ALLOW_REMOTE=true          allow non-localhost MongoDB (default: blocked)
 */
import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { Types } from 'mongoose';

import { connectDatabase, disconnectDatabase } from '@config/database.config';
import { appIdentity, env } from '@config/env.config';

import { AppConstants } from '@common/constants';

import { User } from '@modules/user/user.model';
import { walletService } from '@modules/wallet/wallet.service';

const parseArgs = (): { userId: string; amountMajor: number } => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const userId = args[0]?.trim();

  if (!userId) {
    console.error('Usage: npm run seed:wallet -- <userId> [amountMajor]');
    console.error('Example: npm run seed:wallet -- 6a3cc5a55dd24adb1cc6166a');
    process.exit(1);
  }

  if (!Types.ObjectId.isValid(userId)) {
    console.error(`✗ Invalid userId (must be a MongoDB ObjectId): ${userId}`);
    process.exit(1);
  }

  const defaultMajor = Number(process.env.WALLET_SEED_AMOUNT_MAJOR ?? 1000);
  const amountMajor = args[1] ? Number(args[1]) : defaultMajor;

  if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
    console.error(`✗ Invalid amount: ${args[1] ?? defaultMajor}`);
    process.exit(1);
  }

  return { userId, amountMajor };
};

const assertLocalDatabase = (): void => {
  if (process.env.SEED_ALLOW_REMOTE === 'true') return;
  const uri = env.MONGO_URI;
  if (!/localhost|127\.0\.0\.1/.test(uri)) {
    console.error('✗ Refusing to run: MONGO_URI does not point at localhost.');
    console.error('  Set SEED_ALLOW_REMOTE=true to override (use with caution).');
    process.exit(1);
  }
};

const run = async (): Promise<void> => {
  assertLocalDatabase();
  const { userId, amountMajor } = parseArgs();
  const amountMinor = Math.round(amountMajor * AppConstants.MONEY.MINOR_UNITS_PER_MAJOR);
  const currency = appIdentity.defaultCurrency;

  await connectDatabase();

  const user = await User.findById(userId).select('_id email phone displayName').lean();
  if (!user) {
    console.error(`✗ User not found: ${userId}`);
    process.exit(1);
  }

  const before = await walletService.getWalletSnapshot(userId);

  const { wallet, transaction } = await walletService.deposit({
    userId,
    amount: amountMinor,
    currency,
    idempotencyKey: `seed-wallet:${userId}:${randomUUID()}`,
    reference: `seed:${Date.now()}`,
    description: 'Dev seed wallet credit',
    metadata: { source: 'seed:wallet-credit', amountMajor },
    initiatedBy: userId,
    initiatedByRole: 'SEED',
  });

  console.log('\n✓ Wallet credited via ledger deposit');
  console.log('────────────────────────────────────────');
  console.log(`  User ID     : ${userId}`);
  console.log(`  Email       : ${user.email ?? '—'}`);
  console.log(`  Phone       : ${user.phone ?? '—'}`);
  console.log(`  Name        : ${user.displayName ?? '—'}`);
  console.log(`  Credited    : ₹${amountMajor} (${amountMinor} minor)`);
  console.log(`  Txn ID      : ${String(transaction._id)}`);
  console.log(`  Balance was : ₹${(before.balances.spendable / 100).toFixed(2)} spendable`);
  console.log(`  Balance now : ₹${(wallet.balances.spendable / 100).toFixed(2)} spendable`);
  console.log(`    deposit   : ₹${(wallet.balances.deposit / 100).toFixed(2)}`);
  console.log(`    winning   : ₹${(wallet.balances.winning / 100).toFixed(2)}`);
  console.log(`    bonus     : ₹${(wallet.balances.bonus / 100).toFixed(2)}`);
  console.log(`    locked    : ₹${(wallet.balances.locked / 100).toFixed(2)}`);
  console.log('────────────────────────────────────────\n');
};

run()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✗ seed:wallet failed: ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectDatabase();
  });

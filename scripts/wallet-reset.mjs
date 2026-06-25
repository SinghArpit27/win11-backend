/**
 * Wallet reset utility for local development.
 *
 * Wipes every wallet-related collection so you can re-test deposits /
 * withdraws / ledger flows from a clean slate. SAFE on local databases
 * only — refuses to run unless the connection URI points at localhost.
 *
 * Usage (from `backend/`):
 *   node scripts/wallet-reset.mjs
 *
 * What it clears:
 *   - wallets                (one-per-user balance snapshots)
 *   - wallet_transactions    (high-level credit/debit records)
 *   - transaction_ledgers    (immutable per-bucket double-entry rows)
 *   - payment_attempts       (deposit gateway attempts, if any)
 *   - admin_wallet_actions   (admin adjust/freeze/refund audit trail)
 *   - idempotency keys       (so the next request can reuse old keys)
 *
 * User accounts, roles, sessions, and audit logs are intentionally
 * left untouched — only the financial surface is reset.
 */
import { MongoClient } from 'mongodb';

const URI =
  process.env.MONGO_URI ||
  'mongodb://localhost:27017/win11?replicaSet=rs0&directConnection=true';

const isLocal = /localhost|127\.0\.0\.1/.test(URI);
if (!isLocal) {
  console.error('✗ Refusing to run: MONGO_URI does not point at localhost.');
  console.error('  This script is for local development only.');
  process.exit(1);
}

const COLLECTIONS = [
  'wallets',
  'wallet_transactions',
  'transaction_ledgers',
  'payment_attempts',
  'admin_wallet_actions',
  'idempotency_keys',
];

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });

try {
  await client.connect();
  const dbName = new URL(URI.replace('mongodb://', 'http://')).pathname.replace('/', '') || 'win11';
  const db = client.db(dbName);

  console.log(`✓ Connected to ${dbName}`);

  for (const name of COLLECTIONS) {
    const exists = await db.listCollections({ name }).hasNext();
    if (!exists) {
      console.log(`• ${name.padEnd(24)} — not present, skipping`);
      continue;
    }
    const { deletedCount } = await db.collection(name).deleteMany({});
    console.log(`✓ ${name.padEnd(24)} — cleared ${deletedCount} doc(s)`);
  }

  console.log('\n✓ Wallet state reset. Reload the app and re-deposit to verify.');
  process.exit(0);
} catch (err) {
  console.error(`✗ wallet-reset failed: ${err.message}`);
  process.exit(1);
} finally {
  await client.close();
}

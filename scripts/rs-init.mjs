/**
 * One-time replica-set bootstrap for local development.
 *
 * Phase 3's wallet/ledger system uses `session.withTransaction()` which
 * requires a replica-set member. Local dev runs Mongo as a single-node
 * replica set called `rs0`. This script idempotently initiates the
 * replica set so transactions work without spinning up Docker.
 *
 * Usage (from `backend/`):
 *   node scripts/rs-init.mjs
 *
 * Prerequisites:
 *   - Mongo 7+ installed as a Windows service.
 *   - `mongod.cfg` includes `replication: { replSetName: rs0 }`.
 *   - Service restarted after the config edit.
 *
 * Safe to re-run: if the set is already initiated the script reports
 * the current status and exits 0.
 */
import { MongoClient } from 'mongodb';

const URI = 'mongodb://localhost:27017/?directConnection=true';
const RS_NAME = 'rs0';

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });

try {
  await client.connect();
  const admin = client.db('admin');

  try {
    const result = await admin.command({
      replSetInitiate: {
        _id: RS_NAME,
        members: [{ _id: 0, host: 'localhost:27017' }],
      },
    });
    console.log(`✓ replSetInitiate ok=${result.ok}`);
  } catch (err) {
    if (err?.codeName === 'AlreadyInitialized') {
      console.log('• Replica set already initialized — nothing to do.');
    } else {
      throw err;
    }
  }

  // Wait briefly for the node to transition to PRIMARY.
  for (let i = 0; i < 10; i++) {
    const status = await admin.command({ replSetGetStatus: 1 }).catch(() => null);
    if (status?.myState === 1) {
      console.log(`✓ Node is PRIMARY (set: ${status.set}, members: ${status.members.length})`);
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.warn('! Replica set initiated but no PRIMARY yet — give it a few seconds and try again.');
  process.exit(0);
} catch (err) {
  console.error(`✗ rs-init failed: ${err.message}`);
  process.exit(1);
} finally {
  await client.close();
}

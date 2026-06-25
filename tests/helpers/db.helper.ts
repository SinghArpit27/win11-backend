import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '@config/database.config';

let connected = false;

/** Connect to the isolated test database once per worker. */
export const connectTestDatabase = async (): Promise<void> => {
  if (connected) return;
  await connectDatabase();
  connected = true;
};

export const disconnectTestDatabase = async (): Promise<void> => {
  if (!connected) return;
  await disconnectDatabase();
  connected = false;
};

/**
 * Clears all collections between tests.
 *
 * MongoDB integration tests cannot wrap HTTP requests in a single server-side
 * transaction, so we emulate rollback by wiping every collection after each test.
 * This keeps tests isolated while still exercising real multi-document transactions
 * inside individual requests (contest join, wallet deposit, etc.).
 */
export const rollbackTestDatabase = async (): Promise<void> => {
  const db = mongoose.connection.db;
  if (!db) return;

  const collections = await db.collections();
  await Promise.all(
    collections.map(async (collection) => {
      await collection.deleteMany({});
    }),
  );
};

/** Drop the entire test database (used by globalSetup only). */
export const dropTestDatabase = async (): Promise<void> => {
  const db = mongoose.connection.db;
  if (!db) return;
  await db.dropDatabase();
};

export const isReplicaSetReady = async (): Promise<boolean> => {
  const db = mongoose.connection.db;
  if (!db) return false;
  try {
    const hello = await db.admin().command({ hello: 1 });
    return Boolean(hello.setName);
  } catch {
    return false;
  }
};

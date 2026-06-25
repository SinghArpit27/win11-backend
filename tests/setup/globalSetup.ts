/**
 * One-time setup before the Vitest worker pool starts.
 * Verifies MongoDB is reachable; the worker connects in vitest.setup.ts.
 */
export default async function globalSetup(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require('dotenv') as typeof import('dotenv');

  const root = process.cwd();
  dotenv.config({ path: path.resolve(root, '.env') });
  dotenv.config({ path: path.resolve(root, '.env.test'), override: true });
  process.env.NODE_ENV = 'test';

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set for integration tests. Check backend/.env.test');
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mongoose = require('mongoose') as typeof import('mongoose');

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    await mongoose.connection.db?.dropDatabase();
    await mongoose.disconnect();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown MongoDB connection error';
    throw new Error(
      `Integration tests require MongoDB with replica set at ${uri}. ${message}`,
    );
  }
}

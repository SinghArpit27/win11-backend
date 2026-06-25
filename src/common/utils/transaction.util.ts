import mongoose, { ClientSession } from 'mongoose';

/**
 * Runs the supplied work inside a MongoDB transaction with automatic
 * commit / abort.
 *
 * Requires Mongo to be a replica-set member (or mongos). Local dev runs
 * a single-node replica set `rs0` via `docker-compose.yml` so transactions
 * work the same as in production. The connection URI MUST include
 * `?replicaSet=rs0&directConnection=true` (see `.env.example`).
 *
 * Throwing inside `work` triggers an automatic abort — every Mongo
 * mutation written through `session` rolls back atomically.
 */
export const withTransaction = async <T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> => {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

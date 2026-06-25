import mongoose from 'mongoose';

import { env, isProduction } from './env.config';
import { logger } from './logger.config';

/**
 * Centralised MongoDB connection.
 * - One shared connection used across modules.
 * - Transaction support requires a replica-set in production.
 */
mongoose.set('strictQuery', true);
mongoose.set('autoIndex', !isProduction);

let isConnected = false;

export const connectDatabase = async (): Promise<typeof mongoose> => {
  if (isConnected) return mongoose;

  mongoose.connection.on('connected', () => {
    isConnected = true;
    logger.info({ event: 'mongo.connected' }, 'MongoDB connected');
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn({ event: 'mongo.disconnected' }, 'MongoDB disconnected');
  });

  mongoose.connection.on('error', (err) => {
    logger.error({ event: 'mongo.error', err }, 'MongoDB error');
  });

  await mongoose.connect(env.MONGO_URI, {
    minPoolSize: env.MONGO_MIN_POOL,
    maxPoolSize: env.MONGO_MAX_POOL,
    serverSelectionTimeoutMS: 10_000,
    autoIndex: !isProduction,
  });

  return mongoose;
};

export const disconnectDatabase = async (): Promise<void> => {
  if (!isConnected) return;
  await mongoose.disconnect();
};

export const isDatabaseConnected = (): boolean => isConnected;

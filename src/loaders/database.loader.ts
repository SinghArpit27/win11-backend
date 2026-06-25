import { connectDatabase, disconnectDatabase } from '@config/database.config';
import { logger } from '@config/logger.config';

export const initDatabase = async (): Promise<void> => {
  await connectDatabase();
  logger.info({ event: 'loader.database' }, 'Database loader initialised');
};

export const shutdownDatabase = async (): Promise<void> => {
  await disconnectDatabase();
};

/**
 * Seeds the sports catalogue with mock cricket fixtures for local dev.
 *
 * Usage (from `backend/`):
 *   npm run seed:sports
 */
import { Sport, SportsProviderKey, SyncSource } from '@common/enums';

import { initDatabase, shutdownDatabase } from '@loaders/database.loader';
import { initSportsProviders } from '@modules/sports/sports-provider.registry';
import { sportsIngestionService } from '@modules/sports/sports-ingestion.service';
import { sportsCacheService } from '@modules/sports/sports-cache.service';

const main = async (): Promise<void> => {
  await initDatabase();
  initSportsProviders();

  const report = await sportsIngestionService.syncAll({
    source: SyncSource.MANUAL_ADMIN,
    provider: SportsProviderKey.MOCK,
    sport: Sport.CRICKET,
  });

  await sportsCacheService.flushScope('matches');

  console.log('Sports catalogue seeded.');
  console.log(`  Provider : ${report.provider}`);
  console.log(`  Matches  : ${report.matchesUpserted}`);
  console.log(`  Teams    : ${report.teamsUpserted}`);
  console.log(`  Players  : ${report.playersUpserted}`);
};

main()
  .then(async () => {
    await shutdownDatabase();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await shutdownDatabase();
    process.exit(1);
  });

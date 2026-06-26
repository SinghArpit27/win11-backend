import { env } from '@config/env.config';
import { logger } from '@config/logger.config';
import { isRedisEnabled } from '@config/redis.config';

import { Sport, SportsProviderKey, SyncSource } from '@common/enums';

import { Match } from './match.model';
import { sportsIngestionService } from './sports-ingestion.service';

/**
 * Boot-time, in-process self-healing seed for the sports catalogue.
 *
 *  Why this exists:
 *   - The recurring `match-sync` BullMQ job seeds the DB on a regular
 *     interval, but a fresh deployment with a brand-new DB needs the
 *     catalogue populated *immediately* so the user can browse matches
 *     and Phase 5/6 flows have a non-empty source of truth.
 *   - When `REDIS_ENABLED=false` the BullMQ workers never run, so we
 *     refresh match feeds synchronously on every boot.
 *
 *  Strategy:
 *   - Empty DB → full `syncAll()` from the best configured provider.
 *   - Populated DB + (Redis off OR real API key) → lighter
 *     `refreshMatchCatalogue()` so statuses and `scheduledAt` values
 *     stay current (fixes stale mock LIVE rows + empty upcoming feeds).
 *   - CRIC_API failures fall back to the mock provider so dev never
 *     blocks on upstream quota/network issues.
 */
export const initSportsSeeds = async (): Promise<void> => {
  try {
    const existing = await Match.estimatedDocumentCount();
    const preferredProvider = env.CRIC_API_KEY
      ? SportsProviderKey.CRIC_API
      : SportsProviderKey.MOCK;
    const shouldRefresh = !isRedisEnabled() || !!env.CRIC_API_KEY;

    if (existing === 0) {
      logger.info(
        { event: 'sports.seed.start', provider: preferredProvider },
        'Empty matches collection detected — running in-process boot sync',
      );
      await runSync(preferredProvider, true);
      return;
    }

    if (!shouldRefresh) {
      logger.debug(
        { event: 'sports.seed.skip', existing },
        'Sports catalogue already populated — skipping boot seed',
      );
      return;
    }

    logger.info(
      { event: 'sports.seed.refresh', existing, provider: preferredProvider },
      'Refreshing match catalogue on boot',
    );
    await runSync(preferredProvider, false);
  } catch (err) {
    logger.warn({ err, event: 'sports.seed.failed' }, 'Boot seed failed; will retry via scheduled job');
  }
};

const runSync = async (provider: SportsProviderKey, full: boolean): Promise<void> => {
  try {
    const report = full
      ? await sportsIngestionService.syncAll({
          source: SyncSource.SYSTEM_BOOT,
          provider,
          sport: Sport.CRICKET,
        })
      : await sportsIngestionService.refreshMatchCatalogue({
          source: SyncSource.SYSTEM_BOOT,
          provider,
          sport: Sport.CRICKET,
        });

    logger.info(
      {
        event: full ? 'sports.seed.complete' : 'sports.seed.refresh.complete',
        provider: report.provider,
        matches: report.matchesUpserted,
        statusChanged: report.matchesStatusChanged,
      },
      full ? 'Sports boot seed complete' : 'Sports boot refresh complete',
    );
  } catch (err) {
    if (provider === SportsProviderKey.MOCK) throw err;

    // When a real API key is configured, never re-seed mock LIVE fixtures —
    // that overwrites the home feed with demo MI-vs-CSK rows. Just heal
    // stale statuses and flush caches until quota resets.
    if (env.CRIC_API_KEY) {
      const statusChanged = await sportsIngestionService.reconcileCatalogueOnly({
        source: SyncSource.SYSTEM_BOOT,
        provider,
        sport: Sport.CRICKET,
      });

      logger.warn(
        { err, provider, statusChanged, event: 'sports.seed.api_unavailable' },
        'CricAPI sync failed — reconciled catalogue without mock fallback',
      );
    } else {
      logger.warn(
        { err, provider, fallback: SportsProviderKey.MOCK },
        'Primary sports provider sync failed — falling back to mock refresh',
      );

      const report = full
        ? await sportsIngestionService.syncAll({
            source: SyncSource.SYSTEM_BOOT,
            provider: SportsProviderKey.MOCK,
            sport: Sport.CRICKET,
          })
        : await sportsIngestionService.refreshMatchCatalogue({
            source: SyncSource.SYSTEM_BOOT,
            provider: SportsProviderKey.MOCK,
            sport: Sport.CRICKET,
          });

      logger.info(
        {
          event: 'sports.seed.fallback.complete',
          provider: report.provider,
          matches: report.matchesUpserted,
          statusChanged: report.matchesStatusChanged,
        },
        'Sports boot refresh complete (mock fallback)',
      );
    }
  }

  await ensureCataloguePopulated();
};

/** Guarantees dev/demo always has fixtures when the external feed is empty or unavailable. */
const ensureCataloguePopulated = async (): Promise<void> => {
  const count = await Match.estimatedDocumentCount();
  if (count > 0) return;

  logger.warn(
    { event: 'sports.seed.mock_empty_catalogue' },
    'Matches collection still empty — seeding mock cricket fixtures',
  );

  const report = await sportsIngestionService.syncAll({
    source: SyncSource.SYSTEM_BOOT,
    provider: SportsProviderKey.MOCK,
    sport: Sport.CRICKET,
  });

  logger.info(
    {
      event: 'sports.seed.mock_complete',
      provider: report.provider,
      matches: report.matchesUpserted,
    },
    'Mock sports catalogue seeded',
  );
};

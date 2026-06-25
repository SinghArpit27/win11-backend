import type { Server as HttpServer } from 'node:http';

import { logger } from '@config/logger.config';
import { isRedisEnabled } from '@config/redis.config';

import { initNotificationJobs } from '@modules/notification';
import { initFinancialSettlementJobs } from '@jobs/financial-settlement.jobs';
import { initRealtimeJobs } from '@jobs/realtime.jobs';
import { initScoringJobs, unscheduleScoringJobs } from '@jobs/scoring.jobs';
import { initSportsJobs, unscheduleSportsJobs } from '@jobs/sports.jobs';

import { initContestSeeds } from '@modules/contest/contest.bootstrap';
import { initFantasySeeds } from '@modules/fantasy/fantasy.bootstrap';
import { roleService } from '@modules/role/role.service';
import { initSportsProviders } from '@modules/sports/sports-provider.registry';
import { initSportsSeeds } from '@modules/sports/sports.bootstrap';

import { initDatabase, shutdownDatabase } from './database.loader';
import { initQueueLayer, shutdownQueueLayer } from './queue.loader';
import { initRedis, shutdownRedis } from './redis.loader';
import { initSockets, shutdownSockets } from './socket.loader';

export { buildExpressApp } from './express.loader';

/**
 * Boots every external dependency in the order required by the runtime
 * graph. The HTTP listener is bound separately in `server.ts` once all
 * loaders resolve.
 *
 * `seedSystemRoles` runs idempotently after the DB connects so a fresh
 * environment always has the canonical role rows for the admin UI to
 * render against — without requiring a separate migration step in Phase 2.
 *
 * Phase 4 additions:
 *  - `initSportsProviders` registers the default mock provider (+ any
 *    real providers configured via env) into the global registry.
 *  - `initSportsJobs` registers the BullMQ workers + recurring schedulers
 *    for match-sync, live-score, player-sync, and cache-refresh.
 *  Both run AFTER the queue layer so the workers attach to live queues.
 */
export const bootstrapLoaders = async (httpServer: HttpServer): Promise<void> => {
  await initDatabase();
  await initRedis();
  await initQueueLayer();
  await initSockets(httpServer);
  try {
    await roleService.seedSystemRoles();
  } catch (err) {
    logger.warn({ err }, 'role.seed.failed (non-fatal)');
  }

  // PHASE 4 — sports providers + ingestion jobs
  try {
    initSportsProviders();
    if (isRedisEnabled()) {
      await initSportsJobs();
    } else {
      logger.info({ event: 'sports.jobs.skipped' }, 'Redis disabled — skipping sports BullMQ jobs');
    }
  } catch (err) {
    logger.warn({ err }, 'sports.init.failed (non-fatal)');
  }

  // PHASE 4 — in-process self-healing seed.
  // Guarantees the matches list is non-empty on a fresh DB regardless
  // of BullMQ / Redis health. Skipped when the catalogue is populated.
  try {
    await initSportsSeeds();
  } catch (err) {
    logger.warn({ err }, 'sports.seed.failed (non-fatal)');
  }

  // PHASE 5 — seed default fantasy rules + scoring rules
  try {
    await initFantasySeeds();
  } catch (err) {
    logger.warn({ err }, 'fantasy.seed.failed (non-fatal)');
  }

  // PHASE 6 — seed default contest templates + prize distributions
  try {
    await initContestSeeds();
  } catch (err) {
    logger.warn({ err }, 'contest.seed.failed (non-fatal)');
  }

  // PHASE 7 — scoring + leaderboard + settlement workers + snapshot tick
  try {
    if (isRedisEnabled()) {
      await initScoringJobs();
    } else {
      logger.info({ event: 'scoring.jobs.skipped' }, 'Redis disabled — skipping scoring BullMQ jobs');
    }
  } catch (err) {
    logger.warn({ err }, 'scoring.init.failed (non-fatal)');
  }

  // PHASE 8 — realtime event bus + notification workers
  try {
    if (isRedisEnabled()) {
      await initRealtimeJobs();
      initNotificationJobs();
      initFinancialSettlementJobs();
    } else {
      await initRealtimeJobs();
      logger.info({ event: 'realtime.local' }, 'Redis disabled — realtime uses in-process dispatch');
    }
  } catch (err) {
    logger.warn({ err }, 'realtime.init.failed (non-fatal)');
  }

  logger.info('All loaders bootstrapped');
};

export const shutdownLoaders = async (): Promise<void> => {
  if (isRedisEnabled()) {
    await unscheduleScoringJobs().catch(() => undefined);
    await unscheduleSportsJobs().catch(() => undefined);
  }
  await shutdownSockets();
  await shutdownQueueLayer();
  await shutdownRedis();
  await shutdownDatabase();
};

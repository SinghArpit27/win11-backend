import { logger } from '@config/logger.config';

import { Sport, SportsProviderKey } from '@common/enums';

import { createCricApiProvider } from './cric-api.provider';
import { mockSportsProvider } from './mock-sports.provider';
import type { ISportsProvider } from './sports-provider.types';

/**
 * Provider registry.
 *
 * Why a registry rather than `import { provider } from '...'`?
 *
 *  - **Failover:** the ingestion service asks for "the best provider for
 *    cricket right now" and the registry picks from the priority list,
 *    skipping unhealthy or unconfigured providers.
 *  - **Pluggability:** new providers register on boot via `register()` so
 *    feature code never imports concrete providers.
 *  - **Testability:** tests can call `clearProviders()` + `register(mock)`
 *    to swap implementations without monkey-patching.
 *
 * The mock provider is registered eagerly so the platform always has at
 * least one working data source. Real providers (CricAPI etc.) register
 * during boot only if their env vars are configured — keeping the
 * deployment surface minimal.
 */
class SportsProviderRegistry {
  private readonly providers = new Map<SportsProviderKey, ISportsProvider>();
  /**
   * Priority order — lower index = preferred. Failover walks this list
   * looking for the first healthy provider that supports the sport.
   */
  private readonly priority: SportsProviderKey[] = [
    SportsProviderKey.CRIC_API,
    SportsProviderKey.SPORT_RADAR,
    SportsProviderKey.ROANUZ,
    SportsProviderKey.MOCK,
  ];

  /** Register a provider. Idempotent — a second call overwrites the first. */
  register(provider: ISportsProvider): void {
    const wasPresent = this.providers.has(provider.key);
    this.providers.set(provider.key, provider);
    logger.info(
      { event: 'sports.provider.registered', key: provider.key, replaced: wasPresent },
      `Sports provider registered: ${provider.displayName}`,
    );
  }

  has(key: SportsProviderKey): boolean {
    return this.providers.has(key);
  }

  get(key: SportsProviderKey): ISportsProvider | null {
    return this.providers.get(key) ?? null;
  }

  /**
   * Returns every registered provider in priority order. Use this when
   * ingestion needs to run *every* source in parallel.
   */
  list(): ISportsProvider[] {
    const result: ISportsProvider[] = [];
    for (const key of this.priority) {
      const provider = this.providers.get(key);
      if (provider) result.push(provider);
    }
    return result;
  }

  /**
   * Picks the highest-priority provider that supports the given sport.
   * `null` only if NO providers are registered (the mock should always
   * be available, so this typically only happens in unit tests that
   * called `clear()`).
   */
  resolveForSport(sport: Sport): ISportsProvider | null {
    for (const key of this.priority) {
      const provider = this.providers.get(key);
      if (provider?.supportedSports.includes(sport)) return provider;
    }
    // Fallback — any provider, even if it doesn't formally list the sport.
    return this.list()[0] ?? null;
  }

  clear(): void {
    this.providers.clear();
  }
}

export const sportsProviderRegistry = new SportsProviderRegistry();

/**
 * Boots the registry with the mock provider. Called from
 * `loaders/index.ts`. Future providers (CricAPI, SportRadar, etc.) are
 * registered here too — gated on env vars / feature flags.
 */
export const initSportsProviders = (): void => {
  // Mock is always registered — guarantees the platform is never
  // dependent on an external API to boot or render the create-team UI.
  sportsProviderRegistry.register(mockSportsProvider);

  // CricketData.org — activates only when `CRIC_API_KEY` is set in env.
  // Free tier: 100 hits / day. Sign up at https://cricketdata.org/signup.aspx
  const cricApi = createCricApiProvider();
  if (cricApi) sportsProviderRegistry.register(cricApi);

  logger.info(
    {
      event: 'sports.providers.init',
      providers: sportsProviderRegistry.list().map((p) => p.key),
    },
    'Sports provider registry initialised',
  );
};

export { SportsProviderRegistry };

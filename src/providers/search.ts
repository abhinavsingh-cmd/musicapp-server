/**
 * Provider-agnostic search facade.
 *
 * Fans a query out to every registered provider that declares the `search`
 * capability and returns one normalized result per provider. Consumers
 * (search store, future discovery surfaces) never import a specific
 * provider's search implementation — adding a new provider requires no
 * change here or in the UI, only registration.
 *
 * Failures are isolated per provider: one provider's network error is
 * reported on its own result entry and never rejects the whole search.
 *
 * Provider health is tracked automatically: successful searches improve
 * health scores, while 429/503/timeout/network errors degrade them.
 * Unhealthy providers are searched after healthy ones, improving overall
 * search reliability.
 */

import { providerRegistry } from './registry';
import { healthTracker } from './healthTracker';
import {
  safeProviderCall,
  SEARCH_TIMEOUT_MS,
  kindToHealthEvent,
} from './safeProviderCall';
import { logger } from '../utils/logger';
import { ProviderId, SearchOptions, Track, TrackProvider } from './types';
// Ensure built-in providers are registered (idempotent). Static import: the
// barrel is already in the main bundle via audioService, and a dynamic
// import here prevents Vite from ever code-splitting the providers chunk.
import './index';

export interface ProviderSearchResult {
  providerId: ProviderId;
  providerName: string;
  /** Normalized tracks from this provider (empty on failure). */
  tracks: Track[];
  /** Set when this provider's search failed; other providers are unaffected. */
  error?: Error;
}

export interface ProviderSearchOptions extends SearchOptions {
  /** Restrict the fan-out to specific providers (default: all searchable). */
  providers?: ProviderId[];
}

/** Make sure the built-in providers are registered (idempotent). */
async function ensureBuiltinProviders(): Promise<void> {
  // Built-ins are registered at module load via the static import above.
  return Promise.resolve();
}

function searchableProviders(filter?: ProviderId[]): TrackProvider[] {
  return providerRegistry
    .list()
    .filter(p => p.capabilities.search)
    .filter(p => !filter || filter.length === 0 || filter.includes(p.id));
}

/**
 * Search every registered provider that supports search.
 *
 * Results arrive in health-sorted order with one entry per provider.
 * A provider that throws produces `{ tracks: [], error }` instead of
 * rejecting the aggregate — callers decide how to surface or ignore
 * individual failures.
 *
 * Provider health is tracked: successful searches are recorded as
 * successes, while 429/503/timeout/network errors are recorded as
 * failures. Unhealthy providers are deprioritized in the search order.
 */
export async function searchProviders(
  query: string,
  options?: ProviderSearchOptions,
): Promise<ProviderSearchResult[]> {
  await ensureBuiltinProviders();

  // Get searchable providers and sort by health (healthiest first)
  const targets = searchableProviders(options?.providers);
  const sortedIds = healthTracker.sortByHealth(targets.map(p => p.id));
  const sortedTargets = sortedIds
    .map(id => targets.find(p => p.id === id))
    .filter((p): p is TrackProvider => p !== undefined);

  // Wrap each provider's search in safeProviderCall — one provider's timeout
  // or exception can never block or crash the entire search.
  const results = await Promise.all(
    sortedTargets.map(p =>
      safeProviderCall(
        () => p.search(query, options),
        `${p.id}.search`,
        SEARCH_TIMEOUT_MS,
      ),
    ),
  );

  return sortedTargets.map((provider, i) => {
    const outcome = results[i];

    if (outcome.ok) {
      healthTracker.record(provider.id, 'success');
      return {
        providerId: provider.id,
        providerName: provider.name,
        tracks: outcome.value ?? [],
      };
    }

    // Classify failure for health tracking
    const healthEvent = kindToHealthEvent(outcome.kind);
    if (healthEvent) {
      healthTracker.record(provider.id, healthEvent);
    }

    logger.warn(
      '[Providers] search failed for',
      provider.id,
      `(${outcome.kind})`,
      outcome.message,
    );

    return {
      providerId: provider.id,
      providerName: provider.name,
      tracks: [],
      error: new Error(outcome.message),
    };
  });
}

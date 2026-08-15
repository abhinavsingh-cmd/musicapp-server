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
 */

import { providerRegistry } from './registry';
import { logger } from '../utils/logger';
import { ProviderId, SearchOptions, Track, TrackProvider } from './types';

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
  await import('./index');
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
 * Results arrive in registry order with one entry per provider. A provider
 * that throws produces `{ tracks: [], error }` instead of rejecting the
 * aggregate — callers decide how to surface or ignore individual failures.
 */
export async function searchProviders(
  query: string,
  options?: ProviderSearchOptions,
): Promise<ProviderSearchResult[]> {
  await ensureBuiltinProviders();

  const targets = searchableProviders(options?.providers);
  const settled = await Promise.allSettled(
    targets.map(p => p.search(query, options)),
  );

  return targets.map((provider, i) => {
    const outcome = settled[i];
    if (outcome.status === 'fulfilled') {
      return {
        providerId: provider.id,
        providerName: provider.name,
        tracks: outcome.value ?? [],
      };
    }
    const error =
      outcome.reason instanceof Error
        ? outcome.reason
        : new Error(String(outcome.reason));
    logger.warn(
      '[Providers] search failed for',
      provider.id,
      error.message,
    );
    return {
      providerId: provider.id,
      providerName: provider.name,
      tracks: [],
      error,
    };
  });
}

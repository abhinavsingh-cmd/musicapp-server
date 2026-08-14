import { ProviderId, ProviderRegistry, TrackProvider } from './types';

class Registry implements ProviderRegistry {
  private providers = new Map<ProviderId, TrackProvider>();

  register(provider: TrackProvider): void {
    if (!provider || !provider.id) {
      throw new Error('[Providers] Cannot register a provider without an id');
    }
    if (this.providers.has(provider.id)) {
      throw new Error(`[Providers] Provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: ProviderId | undefined | null): TrackProvider | undefined {
    if (!id) return undefined;
    return this.providers.get(id);
  }

  unregister(id: ProviderId): void {
    this.providers.delete(id);
  }

  list(): TrackProvider[] {
    return Array.from(this.providers.values());
  }

  has(id: ProviderId | undefined | null): boolean {
    return !!id && this.providers.has(id);
  }
}

export const providerRegistry: ProviderRegistry = new Registry();
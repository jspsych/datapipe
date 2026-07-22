import { StorageProvider, StorageProviderId } from "./types.js";

const providers = new Map<StorageProviderId, StorageProvider>();

export function registerProvider(provider: StorageProvider): void {
  if (providers.has(provider.id)) {
    throw new Error(`Storage provider already registered: ${provider.id}`);
  }
  providers.set(provider.id, provider);
}

export function getProvider(id: StorageProviderId): StorageProvider {
  const provider = providers.get(id);
  if (!provider) {
    throw new Error(`Unknown storage provider: ${id}`);
  }
  return provider;
}

export function listProviders(): StorageProviderId[] {
  return [...providers.keys()];
}

// For tests only — production code never unregisters a provider.
export function clearProvidersForTesting(): void {
  providers.clear();
}

import { registerProvider, getProvider } from "./registry.js";
import { osfProvider } from "./osf.js";
import { gdriveProvider } from "./gdrive.js";
import { dataverseProvider } from "./dataverse.js";
import { zenodoProvider } from "./zenodo.js";
import { StorageProvider, StorageProviderId, ContainerRef, OAuthConfig } from "./types.js";
import { ExperimentData } from "../interfaces.js";

registerProvider(osfProvider);
registerProvider(gdriveProvider);
registerProvider(dataverseProvider);
registerProvider(zenodoProvider);

// OAuth config for the generic storage-GRANT flow
// (docs/provider-migration-design.md, scratchpad/step4b-oauth-connect-spec.md).
//
// Reads straight off the registry above -- there is no second provider table.
// Only 'gdrive' implements oauthConfig() today. 'osf' deliberately does not:
// the OSF identity flow (oauth2-callback.ts) is a separate, untouched legacy
// path with its own env vars (CLIENT_ID/CLIENT_SECRET/REDIRECT_URI). Adding
// figshare means adding an oauthConfig() to its adapter, nothing here.
//
// Both failure modes throw, and callers depend on that: connect-provider.ts,
// generate-oauth-state.ts and get-provider-access-token.ts each wrap this in
// try/catch as their validation gate for an arbitrary request-body `provider`
// string. Returning undefined for either case would let unvalidated input
// through.
export function getOAuthConfig(provider: string): OAuthConfig {
  const storageProvider = getProvider(provider as StorageProviderId);
  if (!storageProvider.oauthConfig) {
    throw new Error(`Provider does not support OAuth2: ${provider}`);
  }
  return storageProvider.oauthConfig();
}

// The name the collision cache must hash for a file being written to
// `filename` on this provider -- i.e. the name that provider's listFiles will
// report for it once written (see StorageProvider.storedNameFor). Every
// claimFilename/confirmClaim call site goes through this rather than hashing a
// raw request filename, so claims made before a write and claims rehydrated
// from a listing can never fall into different namespaces.
export function claimNameFor(provider: StorageProvider, filename: string): string {
  return provider.storedNameFor ? provider.storedNameFor(filename) : filename;
}

export function getProviderForExperiment(exp_data: ExperimentData): {
  provider: StorageProvider;
  container: ContainerRef;
} {
  if (exp_data.storageProvider) {
    return {
      provider: getProvider(exp_data.storageProvider),
      container: exp_data.providerContainer as ContainerRef,
    };
  }

  // Legacy default: experiments created before the provider-migration schema
  // have no storageProvider field and always write to OSF.
  return {
    provider: osfProvider,
    container: { provider: "osf", filesLink: exp_data.osfFilesLink },
  };
}

export { registerProvider, getProvider, listProviders } from "./registry.js";
export { osfProvider } from "./osf.js";
export { gdriveProvider } from "./gdrive.js";
export { dataverseProvider } from "./dataverse.js";
export { zenodoProvider } from "./zenodo.js";
export * from "./types.js";

import { registerProvider, getProvider } from "./registry.js";
import { osfProvider } from "./osf.js";
import { gdriveProvider } from "./gdrive.js";
import { StorageProvider, ContainerRef } from "./types.js";
import { ExperimentData } from "../interfaces.js";

registerProvider(osfProvider);
registerProvider(gdriveProvider);

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

export { registerProvider, getProvider } from "./registry.js";
export { osfProvider } from "./osf.js";
export { gdriveProvider } from "./gdrive.js";
export * from "./types.js";

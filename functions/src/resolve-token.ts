import { ExperimentData, UserData } from './interfaces';
import { getProviderForExperiment } from "./providers/index.js";
import { TokenResult } from "./providers/types.js";

export { TokenResult };

export default async function resolveToken(
  user_data: UserData,
  exp_data: ExperimentData,
): Promise<TokenResult> {
  // getProviderForExperiment -> getProvider throws for an unregistered/
  // unsupported storageProvider id, but historically an unsupported provider
  // here returned a failure result rather than throwing. Callers distinguish
  // the two: a returned !success becomes an HTTP 400 with a specific message,
  // while a throw is caught elsewhere and becomes an HTTP 500
  // TOKEN_RESOLUTION_ERROR. So the lookup is wrapped to preserve the old
  // failure-result behavior; the resolveToken call itself is allowed to
  // throw as it always has.
  let provider;
  try {
    ({ provider } = getProviderForExperiment(exp_data));
  } catch {
    return {
      success: false,
      error: "PROVIDER_NOT_CONNECTED",
      detail: `Unsupported storage provider: ${exp_data.storageProvider}`,
    };
  }

  return provider.resolveToken(user_data, exp_data.owner);
}

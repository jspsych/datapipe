import {
  AUTH_PROVIDERS,
  AUTH_PROVIDER_LIST,
  ORCID_PROVIDER_ID,
  PASSWORD_PROVIDER_ID,
  canUnlink,
  getAuthProviderByProviderId,
  linkedProviderIds,
} from "../lib/auth-providers";
import { AUTH_PROVIDER_ICONS } from "../components/AuthProviderIcons";

describe("AUTH_PROVIDERS registry", () => {
  it("offers exactly Google, ORCID and GitHub", () => {
    expect(Object.keys(AUTH_PROVIDERS).sort()).toEqual([
      "github",
      "google",
      "orcid",
    ]);
  });

  it("does NOT include OSF -- it is being removed as a sign-in method", () => {
    expect(AUTH_PROVIDERS.osf).toBeUndefined();
    expect(
      AUTH_PROVIDER_LIST.some((entry) => /osf/i.test(entry.providerId))
    ).toBe(false);
  });

  it("maps each entry to the Firebase provider id Firebase itself reports", () => {
    expect(AUTH_PROVIDERS.google.providerId).toBe("google.com");
    expect(AUTH_PROVIDERS.github.providerId).toBe("github.com");
    // Firebase requires generic OIDC ids to carry the "oidc." prefix, and
    // this string must match the Identity Platform console registration
    // exactly or sign-in cannot be routed.
    expect(AUTH_PROVIDERS.orcid.providerId).toBe("oidc.orcid");
    expect(ORCID_PROVIDER_ID).toBe("oidc.orcid");
  });

  it("builds a usable Firebase AuthProvider for every entry", () => {
    for (const entry of AUTH_PROVIDER_LIST) {
      const provider = entry.makeProvider();
      expect(provider.providerId).toBe(entry.providerId);
    }
  });

  it("requests the openid scope for ORCID, which will not issue an id_token without it", () => {
    expect(AUTH_PROVIDERS.orcid.makeProvider().getScopes()).toContain("openid");
  });

  it("requests user:email for GitHub, which otherwise withholds private addresses", () => {
    expect(AUTH_PROVIDERS.github.makeProvider().getScopes()).toContain(
      "user:email"
    );
  });

  it("flags ORCID as not guaranteeing an email address", () => {
    // Researchers routinely keep their ORCID email private, so a successful
    // ORCID sign-in can yield user.email === null. Anything that assumes an
    // address must consult this rather than assume.
    expect(AUTH_PROVIDERS.orcid.providesEmail).toBe(false);
    expect(AUTH_PROVIDERS.google.providesEmail).toBe(true);
    expect(AUTH_PROVIDERS.github.providesEmail).toBe(true);
  });

  it("has an icon for every entry", () => {
    for (const entry of AUTH_PROVIDER_LIST) {
      expect(AUTH_PROVIDER_ICONS[entry.id]).toBeDefined();
    }
  });
});

describe("getAuthProviderByProviderId", () => {
  it("resolves a Firebase provider id back to its registry entry", () => {
    expect(getAuthProviderByProviderId("google.com")).toBe(
      AUTH_PROVIDERS.google
    );
    expect(getAuthProviderByProviderId("oidc.orcid")).toBe(AUTH_PROVIDERS.orcid);
  });

  it("returns null for methods that are not popup providers", () => {
    // "password" is a real sign-in method but deliberately not in the
    // registry -- mapping over it would render a button that cannot work.
    expect(getAuthProviderByProviderId(PASSWORD_PROVIDER_ID)).toBeNull();
    expect(getAuthProviderByProviderId("facebook.com")).toBeNull();
    expect(getAuthProviderByProviderId(undefined)).toBeNull();
  });
});

describe("linkedProviderIds", () => {
  it("reads the provider ids off a Firebase user", () => {
    expect(
      linkedProviderIds({
        providerData: [{ providerId: "google.com" }, { providerId: "password" }],
      })
    ).toEqual(["google.com", "password"]);
  });

  it("is empty for an OSF custom-token session and for no user at all", () => {
    // This is the exact signal AddSignInMethodBanner keys on: OSF sign-in
    // mints a custom token, which carries no federated provider and no
    // password, so providerData is empty. Zero linked providers means the
    // account is reachable ONLY by the flow that is being removed.
    expect(linkedProviderIds({ providerData: [] })).toEqual([]);
    expect(linkedProviderIds({})).toEqual([]);
    expect(linkedProviderIds(null)).toEqual([]);
  });
});

describe("canUnlink", () => {
  it("allows unlinking while another method remains", () => {
    expect(canUnlink(["google.com", "github.com"], "google.com")).toBe(true);
    // A password counts as a way back in, so the federated one can go.
    expect(canUnlink(["google.com", "password"], "google.com")).toBe(true);
  });

  it("refuses to unlink the only remaining method", () => {
    // Otherwise the researcher is locked out of an account that still owns
    // their experiments.
    expect(canUnlink(["google.com"], "google.com")).toBe(false);
    expect(canUnlink([], "google.com")).toBe(false);
    expect(canUnlink(undefined, "google.com")).toBe(false);
  });
});

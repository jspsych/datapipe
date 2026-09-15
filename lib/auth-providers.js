// Frontend registry of SIGN-IN providers. Deliberately shaped like
// lib/provider-config.js's STORAGE_PROVIDERS so the two read alike -- but the
// two registries are unrelated and must not be conflated:
//
//   STORAGE_PROVIDERS (provider-config.js) = where a researcher's DATA goes.
//   AUTH_PROVIDERS    (this file)          = how a researcher SIGNS IN.
//
// OSF used to be both at once -- one `osf.full_write` consent produced both
// the identity and the storage grant (see functions/src/oauth2-callback.ts) --
// which is exactly the coupling this split removes.
//
// Every entry resolves to a Firebase AuthProvider instance, so every call site
// is uniform regardless of provider:
//
//   signInWithPopup(auth, entry.makeProvider())
//   linkWithPopup(auth.currentUser, entry.makeProvider())
//   unlink(auth.currentUser, entry.providerId)
//
// Adding a provider later is one entry here, one icon in
// components/AuthProviderIcons.js, and the console configuration. No server
// code participates in sign-in at all.
//
// NOTE: this module must never import lib/firebase.js. It only needs the
// provider CLASSES from firebase/auth, and staying free of the app
// initialization keeps it importable in tests without a real Firebase config.
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
} from "firebase/auth";

// Firebase requires generic OIDC provider ids to be prefixed "oidc.". This
// string must match the provider id registered in the Identity Platform
// console exactly -- Firebase has no other way to route the sign-in.
export const ORCID_PROVIDER_ID = "oidc.orcid";

// Email/password is a sign-in method but not a popup provider: it has its own
// form and its own account-page section. It is kept out of AUTH_PROVIDERS so
// that mapping over the registry never renders a button that cannot work, but
// the account page still needs to name it when listing linked methods.
export const PASSWORD_PROVIDER_ID = "password";

export const AUTH_PROVIDERS = {
  google: {
    id: "google",
    name: "Google",
    providerId: GoogleAuthProvider.PROVIDER_ID,
    // Google always returns a verified email address on the credential.
    providesEmail: true,
    makeProvider: () => new GoogleAuthProvider(),
  },
  orcid: {
    id: "orcid",
    name: "ORCID",
    providerId: ORCID_PROVIDER_ID,
    // ORCID lets researchers keep their email address private, and most do,
    // so a perfectly successful ORCID sign-in can still yield
    // `user.email === null`. Everything downstream must tolerate that --
    // see ensureUserDocument in lib/user-bootstrap.js.
    providesEmail: false,
    makeProvider: () => {
      const provider = new OAuthProvider(ORCID_PROVIDER_ID);
      // ORCID only returns an id_token when the client explicitly asks for
      // the `openid` scope; without it the flow degrades to plain OAuth2 and
      // Firebase cannot complete the sign-in.
      provider.addScope("openid");
      return provider;
    },
  },
  github: {
    id: "github",
    name: "GitHub",
    providerId: GithubAuthProvider.PROVIDER_ID,
    providesEmail: true,
    makeProvider: () => {
      const provider = new GithubAuthProvider();
      // Without this scope GitHub only discloses an email when the user has
      // made it public on their profile, which most have not.
      provider.addScope("user:email");
      return provider;
    },
  },
};

// Stable display order for the sign-in buttons and the account page.
export const AUTH_PROVIDER_LIST = Object.values(AUTH_PROVIDERS);

// Firebase reports linked methods as provider-id strings on
// `user.providerData`; this maps one back to its registry entry. Returns null
// for anything not in the registry -- notably "password", and any legacy
// provider a user linked before it was removed from the registry.
export function getAuthProviderByProviderId(providerId) {
  return (
    AUTH_PROVIDER_LIST.find((entry) => entry.providerId === providerId) || null
  );
}

// The provider-id strings a Firebase user currently has linked.
export function linkedProviderIds(user) {
  return (user?.providerData || []).map((info) => info.providerId);
}

// True when a user with these linked methods could still sign in after
// `providerId` is unlinked. Unlinking the only remaining method would lock the
// researcher out of an account that still owns their experiments, so the UI
// must refuse it. Takes the id list rather than a user so it can be called
// against local state mid-flow, before the auth object has settled.
export function canUnlink(linkedIds, providerId) {
  return (linkedIds || []).some((id) => id !== providerId);
}

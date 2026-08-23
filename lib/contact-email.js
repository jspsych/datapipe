// Single source of truth for what counts as a usable DataPipe contact address.
//
// `users/{uid}.contactEmail` is the address DataPipe uses to tell a researcher
// that their data stopped arriving. It is deliberately NOT the Firebase Auth
// `user.email`: Auth enforces global uniqueness on that field (a lab that
// wants failures to land in lab-data@university.edu for two accounts would be
// refused with auth/email-already-in-use), and writing it would change the
// identifier a password signs in with -- see
// components/account/LinkedAccounts.js, which builds
// EmailAuthProvider.credential(user.email, password). A notification address
// is not a credential address.
//
// Every module that decides "does this user have a reachable address?" must
// come through here: the AuthCheck gate, the account page, and the
// notification path. The backend mirror of these predicates lives in
// functions/src/mail.ts -- functions/ is a separate package whose tsconfig
// rootDir is ./src and whose deploy bundle contains only functions/, so this
// file cannot be imported there. THE TWO MUST BE KEPT IN SYNC; the rules that
// matter (the synthetic-OSF pattern and the 254-character cap) are restated in
// firestore.rules as well.

// Mirrors the cap asserted in firestore.rules (isContactEmailUpdate). 254 is
// the maximum length of an addr-spec that SMTP is required to accept.
export const MAX_CONTACT_EMAIL_LENGTH = 254;

// Provenance marker on users/{uid}.contactEmailSource. Diagnostic only --
// nothing branches on it, and firestore.rules does not constrain its value.
//
// There is no "osf-backfill" source. See SEEDING RULE below: an address that
// came from OSF is never seedable, so no code may ever record that it was.
export const CONTACT_EMAIL_SOURCES = Object.freeze({
  // Copied from the Firebase Auth record (`user.email`) at signup, or by a
  // backfill that reads Firebase Auth. The only automatic source there is.
  AUTH: "auth",
  // Typed by the researcher, in the gate or on the account page.
  USER: "user",
});

// oauth2-callback.ts seeds `let osfEmail = user-${osfUserId}@osf.io` as a
// fallback and keeps it whenever the OSF emails endpoint returns nothing
// usable, so this exact shape sits in the `email` field of real user documents
// today. It is undeliverable. A naive truthiness check on contactEmail would
// treat it as an address and mail into a void forever, which is why the gate
// tests it explicitly.
export const OSF_SYNTHETIC_EMAIL_PATTERN = /^user-[a-z0-9]+@osf\.io$/i;

// Deliberately conservative: exactly one "@", no whitespace, a non-empty local
// part, and a dotted domain with no empty labels. Format validation cannot
// prove deliverability -- that is what the verification code is for (§2.2 of
// the plan) -- so this only needs to reject the typos a researcher can see.
const EMAIL_FORMAT = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// One canonical stored form. Lowercased as well as trimmed because the
// verification flow hashes the lowercased address to bind a code to the
// address it was sent to; keeping storage and hash input identical means the
// binding can compare against the stored value directly. Every mail provider
// that matters treats the local part case-insensitively, so nothing becomes
// undeliverable by being lowercased.
export function normalizeContactEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidEmailFormat(value) {
  const v = normalizeContactEmail(value);
  return v.length > 0 && v.length <= MAX_CONTACT_EMAIL_LENGTH && EMAIL_FORMAT.test(v);
}

export function isSyntheticOsfEmail(value) {
  return OSF_SYNTHETIC_EMAIL_PATTERN.test(normalizeContactEmail(value));
}

// The gate's predicate. `userDoc` is the users/{uid} document (or undefined
// while it loads -- callers must handle loading themselves; undefined here is
// simply "no address").
export function hasContactEmail(userDoc) {
  const v = normalizeContactEmail(userDoc?.contactEmail);
  return v.length > 0 && isValidEmailFormat(v) && !isSyntheticOsfEmail(v);
}

// ---------------------------------------------------------------------------
// SEEDING RULE -- read before writing any code that fills contactEmail in
// automatically.
//
// contactEmail may only ever be seeded from the FIREBASE AUTH record's
// `user.email`. That covers email/password signups (always present) and
// federated signups that supply one (Google always, GitHub usually), including
// a researcher who started with email/password and later linked OAuth.
//
// It may NEVER be seeded from `users/{uid}.email`. That field is
// provenance-mixed and, for the OSF-era population, entirely OSF-supplied:
// OSF sign-in mints a Firebase custom token, so those accounts have no Auth
// email at all, and the stored value came from the OSF API or from the
// synthetic `user-{id}@osf.io` fallback. OSF account creation never produced
// an address the researcher gave to DataPipe, so no OSF-derived address is
// seedable -- not the synthetic ones, and not the real-looking ones either.
// Those users type an address into the gate, or they have none.
//
// isSyntheticOsfEmail() above is a backstop for values already sitting in the
// database, NOT a filter that makes the rest of the OSF addresses acceptable.
// ---------------------------------------------------------------------------

// Returns the four contactEmail fields to write for a new user document, given
// the Firebase Auth user. An account with no Auth email (ORCID, OSF-era) gets
// contactEmail: "" and meets the gate on its first /admin load -- the intended
// path, not a failure.
//
// contactEmailVerified is ALWAYS false here, including for Google, whose
// address is provider-verified: firestore.rules refuses a client-written
// `true` in every shape, and one extra confirmation click for the population
// with the least friction elsewhere is not worth a rules exception.
export function contactEmailSeedFromAuthUser(authUser) {
  const candidate = normalizeContactEmail(authUser?.email);
  if (!isValidEmailFormat(candidate) || isSyntheticOsfEmail(candidate)) {
    // No source is recorded, because nothing was sourced. The field appears
    // the first time the researcher saves an address.
    return { contactEmail: "", contactEmailVerified: false };
  }
  return {
    contactEmail: candidate,
    contactEmailVerified: false,
    contactEmailSource: CONTACT_EMAIL_SOURCES.AUTH,
  };
}

// Builds the exact field set a client write of a contact address is allowed to
// touch. Use this rather than assembling the object at each call site:
// firestore.rules' isContactEmailUpdate() permits ONLY these four keys in a
// single write (touching `experiments` in the same operation fails the whole
// write), and it refuses any post-state where contactEmailVerified is true.
//
// That last part is why contactEmailVerified: false is included unconditionally
// rather than omitted: on an update, request.resource.data is the MERGED
// document, so changing the address on an already-verified account without
// resetting the flag would leave `true` standing against a new, unconfirmed
// address -- and the rules deny exactly that write.
export function buildContactEmailUpdate(email, { source = CONTACT_EMAIL_SOURCES.USER } = {}) {
  return {
    contactEmail: normalizeContactEmail(email),
    contactEmailVerified: false,
    contactEmailUpdatedAt: Date.now(),
    contactEmailSource: source,
  };
}

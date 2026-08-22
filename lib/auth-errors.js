// Researcher-facing copy for Firebase Auth error codes, shared by the sign-in
// buttons and the account page's linked-methods section (both run the same
// popup flows, so both hit the same codes).
//
// Modelled on messageForError in components/account/ProviderConnections.js:
// translate the opaque code into something the researcher can act on rather
// than surfacing it verbatim.

// Codes that mean "the researcher backed out", not "something went wrong".
// Callers reset their loading state and show nothing at all for these.
const CANCELLED = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/user-cancelled",
]);

export function isCancelledAuthError(code) {
  return CANCELLED.has(code);
}

// The same code means different things depending on which operation raised it,
// and the advice has to differ with it. `auth/email-already-in-use` from the
// sign-in page means "you already have an account, go in the front door"; the
// identical code from the account page means "you are already inside, and this
// credential belongs to someone else's front door". Telling a researcher who
// is sitting in their account settings to go to their account settings is how
// this went wrong the first time.
const FALLBACK = {
  signIn: (name) => `Could not complete ${name} sign-in. Please try again.`,
  link: (name) => `Could not link your ${name} account. Please try again.`,
  unlink: (name) => `Could not unlink your ${name} account. Please try again.`,
  changePassword: () => "Could not change your password. Please try again.",
  setPassword: () => "Could not add a password to your account. Please try again.",
};

// auth/requires-recent-login means "Firebase wants a fresh session before
// this specific sensitive change," and the fix a researcher needs to hear is
// the name of the change they were making, not a generic phrase about
// sign-in methods. Keyed by mode so DeleteAccount, ChangePassword, and the
// new set-password flow each say the thing the researcher was actually
// trying to do.
const REQUIRES_RECENT_LOGIN = {
  changePassword: "For security, sign out and sign back in, then change your password.",
  setPassword: "For security, sign out and sign back in, then add a password.",
  default: "For security, please sign out and sign back in before changing your sign-in methods.",
};

export function messageForAuthError(
  code,
  providerName = "that provider",
  mode = "signIn"
) {
  switch (code) {
    case "auth/account-exists-with-different-credential":
    case "auth/email-already-in-use":
      // Deliberately does not name the other method. Firebase's email
      // enumeration protection makes fetchSignInMethodsForEmail return
      // nothing, so any specific claim here would be a guess.
      //
      // Firebase allows one account per email address, so linking a
      // credential whose email is already spoken for is refused outright.
      // There is no self-service merge -- experiments are keyed by
      // `owner: uid` and moving them between accounts is a maintainer
      // operation -- so the copy has to say that rather than imply a retry
      // will help.
      if (mode === "setPassword") {
        // The researcher isn't choosing an email here -- it's already fixed
        // to their account's own address, so there is no "use a different
        // email" escape hatch to offer. This only fires if a different
        // Firebase user was somehow already registered with a password under
        // the same address.
        return "This email address is already registered to a different DataPipe account. Contact us through the Contact page if this looks wrong.";
      }
      return mode === "link"
        ? `Your ${providerName} account's email address already belongs to a different DataPipe account, so it can't be linked to this one. Sign out and sign in to that account instead, or link a ${providerName} account that uses a different email address. If you need two accounts combined, get in touch through the Contact page.`
        : `An account already exists with this email address. Sign in using the method you set up originally, then add ${providerName} from your account settings.`;

    case "auth/credential-already-in-use":
    case "auth/provider-already-linked":
      return `That ${providerName} account is already linked to a DataPipe account. Each ${providerName} account can only be linked to one.`;

    case "auth/popup-blocked":
      return "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.";

    case "auth/operation-not-allowed":
      return `${providerName} sign-in is not enabled for DataPipe yet. Please try another method.`;

    case "auth/no-such-provider":
      return `${providerName} is not linked to this account.`;

    case "auth/unauthorized-domain":
      return "This site is not authorized for sign-in. Please report this to the DataPipe maintainers.";

    case "auth/network-request-failed":
      return "Could not reach the authentication service. Check your connection and try again.";

    case "auth/requires-recent-login":
      return REQUIRES_RECENT_LOGIN[mode] || REQUIRES_RECENT_LOGIN.default;

    default:
      return (FALLBACK[mode] || FALLBACK.signIn)(providerName);
  }
}

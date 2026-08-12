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

export function messageForAuthError(code, providerName = "that provider") {
  switch (code) {
    case "auth/account-exists-with-different-credential":
    case "auth/email-already-in-use":
      // Deliberately does not name the other method. Firebase's email
      // enumeration protection makes fetchSignInMethodsForEmail return
      // nothing, so any specific claim here would be a guess.
      return `An account already exists with this email address. Sign in using the method you set up originally, then add ${providerName} from your account settings.`;

    case "auth/credential-already-in-use":
    case "auth/provider-already-linked":
      return `That ${providerName} account is already linked to a DataPipe account. Each ${providerName} account can only be linked to one.`;

    case "auth/popup-blocked":
      return "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.";

    case "auth/operation-not-allowed":
      return `${providerName} sign-in is not enabled for DataPipe yet. Please try another method.`;

    case "auth/unauthorized-domain":
      return "This site is not authorized for sign-in. Please report this to the DataPipe maintainers.";

    case "auth/network-request-failed":
      return "Could not reach the authentication service. Check your connection and try again.";

    case "auth/requires-recent-login":
      return "For security, please sign out and sign back in before changing your sign-in methods.";

    default:
      return `Could not complete ${providerName} sign-in. Please try again.`;
  }
}

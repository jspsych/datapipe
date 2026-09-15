import { messageForAuthError } from "./auth-errors";

// Deprecated. The three auth surfaces that used to own this file's error
// copy (SignInForm, signup, reset-password) now call messageForAuthError
// directly with the right mode ("password" / "signUp" / "resetRequest" /
// "resetConfirm"), which is what lets a code like auth/invalid-credential
// mean different things -- and get shown at a different level of the form
// -- depending on which one raised it. This wrapper exists only in case
// something outside this pass still imports it; it delegates rather than
// keeping its own copy of the map so the two can't drift back out of sync.
export const ERROR = {
  PASSWORD_WEAK: "auth/weak-password",
  PASSWORD_WRONG: "auth/wrong-password",
  TOKEN_INVALID: "auth/invalid-action-code",
  EMAIL_IN_USE: "auth/email-already-in-use",
  EMAIL_INVALID: "auth/invalid-email",
  EMAIL_NOT_FOUND: "auth/user-not-found",
};

export const getError = (code) => messageForAuthError(code);

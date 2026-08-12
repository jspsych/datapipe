import {
  isCancelledAuthError,
  messageForAuthError,
} from "../lib/auth-errors";

describe("isCancelledAuthError", () => {
  it("treats the three popup-dismissal codes as cancellations", () => {
    expect(isCancelledAuthError("auth/popup-closed-by-user")).toBe(true);
    expect(isCancelledAuthError("auth/cancelled-popup-request")).toBe(true);
    expect(isCancelledAuthError("auth/user-cancelled")).toBe(true);
  });

  it("does not swallow real failures", () => {
    expect(isCancelledAuthError("auth/email-already-in-use")).toBe(false);
    expect(isCancelledAuthError("auth/popup-blocked")).toBe(false);
    expect(isCancelledAuthError(undefined)).toBe(false);
  });
});

describe("messageForAuthError email collisions", () => {
  // The bug this pins: an ORCID account has no email address, so the first
  // federated provider a researcher links is the first thing that can collide
  // with an account they already had. Linking then fails with
  // auth/email-already-in-use, and the sign-in wording told them to "sign in
  // using the method you set up originally, then add GitHub from your account
  // settings" -- which is precisely what they had just done.
  it("does not send a linking researcher back to the account page they are on", () => {
    const message = messageForAuthError(
      "auth/email-already-in-use",
      "GitHub",
      "link"
    );
    expect(message).not.toMatch(/account settings/i);
    expect(message).toMatch(/different DataPipe account/i);
    expect(message).toMatch(/GitHub/);
  });

  it("keeps the front-door advice on the sign-in path", () => {
    const message = messageForAuthError(
      "auth/email-already-in-use",
      "Google",
      "signIn"
    );
    expect(message).toMatch(/account settings/i);
  });

  it("defaults to the sign-in wording when no mode is given", () => {
    expect(messageForAuthError("auth/email-already-in-use", "Google")).toBe(
      messageForAuthError("auth/email-already-in-use", "Google", "signIn")
    );
  });

  it("gives the same linking advice for the sign-in-only sibling code", () => {
    expect(
      messageForAuthError(
        "auth/account-exists-with-different-credential",
        "GitHub",
        "link"
      )
    ).toBe(messageForAuthError("auth/email-already-in-use", "GitHub", "link"));
  });

  it("says there is no self-service merge rather than implying a retry helps", () => {
    const message = messageForAuthError(
      "auth/email-already-in-use",
      "GitHub",
      "link"
    );
    expect(message).toMatch(/Contact page/);
    expect(message).not.toMatch(/try again/i);
  });
});

describe("messageForAuthError fallbacks", () => {
  it("names the operation that actually failed", () => {
    expect(messageForAuthError("auth/internal-error", "GitHub", "signIn")).toMatch(
      /sign-in/
    );
    expect(messageForAuthError("auth/internal-error", "GitHub", "link")).toMatch(
      /link your GitHub account/
    );
    expect(
      messageForAuthError("auth/internal-error", "GitHub", "unlink")
    ).toMatch(/unlink your GitHub account/);
  });

  it("falls back to sign-in wording for an unrecognised mode", () => {
    expect(messageForAuthError("auth/internal-error", "GitHub", "wat")).toMatch(
      /sign-in/
    );
  });

  it("has a usable message when the provider name is unknown", () => {
    expect(messageForAuthError("auth/internal-error")).toMatch(
      /that provider/
    );
  });
});

describe("messageForAuthError mode-independent codes", () => {
  it.each([
    ["auth/credential-already-in-use", /already linked to a DataPipe account/],
    ["auth/provider-already-linked", /already linked to a DataPipe account/],
    ["auth/popup-blocked", /blocked the sign-in window/],
    ["auth/operation-not-allowed", /not enabled for DataPipe/],
    ["auth/no-such-provider", /not linked to this account/],
    ["auth/unauthorized-domain", /not authorized for sign-in/],
    ["auth/network-request-failed", /Check your connection/],
    ["auth/requires-recent-login", /sign out and sign back in/],
  ])("%s reads the same in every mode", (code, pattern) => {
    for (const mode of ["signIn", "link", "unlink"]) {
      expect(messageForAuthError(code, "GitHub", mode)).toMatch(pattern);
    }
  });
});

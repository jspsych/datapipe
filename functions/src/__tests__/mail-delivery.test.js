/**
 * @jest-environment node
 */

// Pure coverage for mail-delivery.ts's three decisions.
//
// Everything asserted here is a function of its arguments: the mail
// document -> SendEmailCommand mapping, the error taxonomy, and the claim
// state machine. No emulator, no network, and -- deliberately -- no AWS
// package: mail-delivery.ts imports @aws-sdk/client-sesv2 dynamically, inside
// the transport seam, so nothing in this file loads it. The end-to-end
// behaviour (claiming, retrying, the outcome fields) lives in
// mail-delivery-emulator.test.js.
//
// Imports the COMPILED module (functions/lib/), so `npm --prefix functions run
// build` must run first. Same convention as upload-failure-copy.test.js.
//
// mail-delivery.js reaches app.js transitively (it needs `db` for the claim
// transaction), and app.js calls initializeApp() with no arguments, so the
// emulator bootstrap below has to happen before the dynamic import -- the same
// bootstrap compaction.test.js uses for the same reason. Nothing in this file
// actually talks to Firestore.

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.GCLOUD_PROJECT = "datapipe-test";
// payload/token crypto: any 64-hex key works in tests
process.env.TOKEN_ENCRYPTION_KEY ||= "aa".repeat(32);
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
});

let buildSendEmailInput;
let classifySesError;
let claimDecision;
let missingConfigKeys;
let readMailConfig;
let MailInputError;
// Read from the module rather than restated here: a test that keeps its own
// copy of a constant stops testing anything the day the constant changes.
let LEASE_MS;
let MAX_ATTEMPTS;
let CONFIG_MISSING_ERROR;
let INVALID_DOCUMENT_ERROR;

beforeAll(async () => {
  ({
    buildSendEmailInput,
    classifySesError,
    claimDecision,
    missingConfigKeys,
    readMailConfig,
    MailInputError,
    LEASE_MS,
    MAX_ATTEMPTS,
    CONFIG_MISSING_ERROR,
    INVALID_DOCUMENT_ERROR,
  } = await import("../../lib/mail-delivery.js"));
});

const CONFIG = {
  region: "us-east-1",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret",
  from: "DataPipe <notifications@pipe.jspsych.org>",
  replyTo: "contact@jspsych.org",
};

// Exactly what mail.ts's mailDocument() produces, minus the server timestamp.
function mailDoc(overrides = {}) {
  return {
    to: ["researcher@example.edu"],
    message: {
      subject: "DataPipe couldn't upload data for Working Memory Span",
      text: "The file is not lost.",
      html: "<p>The file is not lost.</p>",
    },
    datapipe: { kind: "upload-failure", owner: "uid-1", experimentID: "exp-1" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Document -> SES request
// ---------------------------------------------------------------------------

describe("buildSendEmailInput", () => {
  test("maps every part of the document onto Simple content", () => {
    const input = buildSendEmailInput(mailDoc(), CONFIG);

    expect(input.FromEmailAddress).toBe(
      "DataPipe <notifications@pipe.jspsych.org>"
    );
    expect(input.Destination.ToAddresses).toEqual(["researcher@example.edu"]);
    expect(input.ReplyToAddresses).toEqual(["contact@jspsych.org"]);
    expect(input.Content.Simple.Subject.Data).toBe(
      "DataPipe couldn't upload data for Working Memory Span"
    );
    expect(input.Content.Simple.Body.Text.Data).toBe("The file is not lost.");
    expect(input.Content.Simple.Body.Html.Data).toBe(
      "<p>The file is not lost.</p>"
    );
    // Non-ASCII shows up in experiment titles routinely; a missing charset
    // renders them as mojibake in the one mail a researcher was going to read.
    expect(input.Content.Simple.Subject.Charset).toBe("UTF-8");
    expect(input.Content.Simple.Body.Text.Charset).toBe("UTF-8");
    expect(input.Content.Simple.Body.Html.Charset).toBe("UTF-8");
  });

  test("omits the Html part entirely when the document has none", () => {
    // mail.ts writes `message` WITHOUT an html key for text-only mail. An
    // empty Html part is not the same thing as no Html part to a mail client.
    const doc = mailDoc({ message: { subject: "s", text: "t" } });
    const input = buildSendEmailInput(doc, CONFIG);

    expect(input.Content.Simple.Body.Text.Data).toBe("t");
    expect(input.Content.Simple.Body).not.toHaveProperty("Html");
  });

  test("omits Reply-To when none is configured", () => {
    const { replyTo, ...noReplyTo } = CONFIG;
    const input = buildSendEmailInput(mailDoc(), noReplyTo);

    expect(input).not.toHaveProperty("ReplyToAddresses");
  });

  test("accepts a bare string recipient as well as an array", () => {
    // mail.ts always writes an array, but the extension contract this replaces
    // also allowed a string, and a hand-written document may well be one.
    const input = buildSendEmailInput(mailDoc({ to: "one@example.edu" }), CONFIG);
    expect(input.Destination.ToAddresses).toEqual(["one@example.edu"]);
  });

  test("drops junk entries rather than handing SES a null recipient", () => {
    const input = buildSendEmailInput(
      mailDoc({ to: [null, "  keep@example.edu  ", "", 42] }),
      CONFIG
    );
    expect(input.Destination.ToAddresses).toEqual(["keep@example.edu"]);
  });

  test("refuses a document with no usable recipient", () => {
    expect(() => buildSendEmailInput(mailDoc({ to: [] }), CONFIG)).toThrow(
      MailInputError
    );
    expect(() => buildSendEmailInput(mailDoc({ to: [null] }), CONFIG)).toThrow(
      MailInputError
    );
    expect(() => buildSendEmailInput({ message: {} }, CONFIG)).toThrow(
      MailInputError
    );
  });

  test("refuses a document with no subject or no text body", () => {
    expect(() =>
      buildSendEmailInput(mailDoc({ message: { text: "t" } }), CONFIG)
    ).toThrow(MailInputError);
    expect(() =>
      buildSendEmailInput(mailDoc({ message: { subject: "s" } }), CONFIG)
    ).toThrow(MailInputError);
  });

  test("the invalid-document error classifies as permanent", () => {
    // It has to: retrying a document with no recipient produces the same
    // document with no recipient. This is the link between the two functions.
    let thrown;
    try {
      buildSendEmailInput(mailDoc({ to: [] }), CONFIG);
    } catch (error) {
      thrown = error;
    }
    expect(thrown.name).toBe(INVALID_DOCUMENT_ERROR);
    expect(classifySesError(thrown).retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Error taxonomy
// ---------------------------------------------------------------------------

describe("classifySesError", () => {
  function sesError(name, extra = {}) {
    const error = new Error(`${name} happened`);
    error.name = name;
    return Object.assign(error, extra);
  }

  const table = [
    // [error, retryable, why]
    ["MessageRejected", false, "bad address / rejected content"],
    ["MailFromDomainNotVerifiedException", false, "domain not verified"],
    ["AccountSuspendedException", false, "account problem"],
    ["SendingPausedException", false, "account problem"],
    ["AccessDeniedException", false, "IAM policy problem"],
    ["UnrecognizedClientException", false, "bad credentials"],
    ["SignatureDoesNotMatch", false, "bad credentials"],
    ["ValidationException", false, "malformed request"],
    ["TooManyRequestsException", true, "throttled"],
    ["ThrottlingException", true, "throttled"],
    ["LimitExceededException", true, "throttled"],
    ["ServiceUnavailableException", true, "SES 5xx"],
    ["InternalServiceErrorException", true, "SES 5xx"],
    ["ENOTFOUND", true, "never connected, so nothing was sent"],
    ["ECONNREFUSED", true, "never connected, so nothing was sent"],
    ["TimeoutError", false, "AMBIGUOUS: may have been accepted"],
    ["AbortError", false, "AMBIGUOUS: may have been accepted"],
    ["ECONNRESET", false, "AMBIGUOUS: may have been accepted"],
  ];

  test.each(table)("%s -> retryable=%s (%s)", (name, retryable) => {
    const classified = classifySesError(sesError(name));
    expect(classified.name).toBe(name);
    expect(classified.retryable).toBe(retryable);
  });

  test("the ambiguous set is terminal on purpose, not by omission", () => {
    // SESv2 SendEmail has no idempotency token, so a request that went out and
    // never answered cannot be retried safely. Retrying risks a SECOND copy of
    // a notification whose entire value is arriving once; not retrying loses
    // at most one, and loses it loudly (the name survives on the document).
    // If this assertion is ever flipped, read the AMBIGUOUS_ERRORS comment in
    // mail-delivery.ts first -- it is a deliberate trade, not a default.
    expect(classifySesError(sesError("TimeoutError")).retryable).toBe(false);
    expect(classifySesError(sesError("ECONNRESET")).retryable).toBe(false);
    // ...and the distinction from "never connected" is the whole reason the
    // two lists are separate.
    expect(classifySesError(sesError("ECONNREFUSED")).retryable).toBe(true);
  });

  test("falls back to the HTTP status when the name is unfamiliar", () => {
    const throttled = classifySesError(
      sesError("SomeNewThrottle", { $metadata: { httpStatusCode: 429 } })
    );
    expect(throttled.retryable).toBe(true);

    const serverSide = classifySesError(
      sesError("SomeNewOutage", { $metadata: { httpStatusCode: 503 } })
    );
    expect(serverSide.retryable).toBe(true);

    const clientSide = classifySesError(
      sesError("SomeNewRefusal", { $metadata: { httpStatusCode: 400 } })
    );
    expect(clientSide.retryable).toBe(false);
  });

  test("honors the SDK's own $retryable hint when nothing else matched", () => {
    const hinted = classifySesError(
      sesError("SomethingNobodyListed", { $retryable: { throttling: true } })
    );
    expect(hinted.retryable).toBe(true);
  });

  test("an unknown, unnamed, statusless error does not consume the retry budget", () => {
    // More likely a defect on our side than a blip on SES's.
    expect(classifySesError(new Error("boom")).retryable).toBe(false);
    expect(classifySesError(new Error("boom")).name).toBe("UnknownError");
    expect(classifySesError(undefined).name).toBe("UnknownError");
    expect(classifySesError("just a string").message).toBe("Unknown error");
  });

  test("reads a node-style `code` when there is no useful name", () => {
    const error = new Error("socket hang up");
    error.code = "ECONNRESET";
    expect(classifySesError(error).name).toBe("ECONNRESET");
  });

  test("never carries a stack, and truncates the message", () => {
    const error = sesError("MessageRejected", { message: "x".repeat(5000) });
    const classified = classifySesError(error);
    expect(classified).toEqual({
      name: "MessageRejected",
      message: "x".repeat(500),
      retryable: false,
    });
    expect(classified).not.toHaveProperty("stack");
  });
});

// ---------------------------------------------------------------------------
// 3. The claim state machine -- "do not send twice", as a table
// ---------------------------------------------------------------------------

describe("claimDecision", () => {
  const NOW = 1_700_000_000_000;
  const ts = (ms) => ({ toMillis: () => ms });

  test("a fresh document with no delivery block is claimable", () => {
    expect(claimDecision(undefined, NOW)).toBe("claim");
    expect(claimDecision({}, NOW)).toBe("claim");
    expect(claimDecision({ state: null }, NOW)).toBe("claim");
  });

  test("an already-delivered document is never sent again", () => {
    // The single most important row in the table: this is what makes a
    // redelivered Firestore create event harmless.
    expect(
      claimDecision({ state: "SUCCESS", attempts: 1 }, NOW)
    ).toBe("skip-delivered");
  });

  test("a live lease means someone may be inside send() right now", () => {
    expect(
      claimDecision(
        {
          state: "PROCESSING",
          attempts: 1,
          leaseExpiresAt: ts(NOW + LEASE_MS - 1000),
        },
        NOW
      )
    ).toBe("skip-in-flight");
  });

  test("an expired lease is a crashed claim and may be taken over", () => {
    // Only reachable once the original owner is provably dead: the lease is
    // several times the function timeout. See LEASE_MS.
    expect(
      claimDecision(
        { state: "PROCESSING", attempts: 1, leaseExpiresAt: ts(NOW - 1) },
        NOW
      )
    ).toBe("claim");
  });

  test("a PROCESSING document with an unreadable lease is treated as stale", () => {
    // A hand-edited or future-written value must not throw inside a
    // transaction; it reads as 0, which is in the past.
    expect(
      claimDecision({ state: "PROCESSING", attempts: 1, leaseExpiresAt: "soon" }, NOW)
    ).toBe("claim");
    expect(claimDecision({ state: "PROCESSING", attempts: 1 }, NOW)).toBe("claim");
  });

  test("a retryable error is claimable; a terminal one is not", () => {
    expect(
      claimDecision({ state: "ERROR", retryable: true, attempts: 1 }, NOW)
    ).toBe("claim");
    expect(
      claimDecision({ state: "ERROR", retryable: false, attempts: 1 }, NOW)
    ).toBe("skip-terminal");
    // Absent is not true.
    expect(claimDecision({ state: "ERROR", attempts: 1 }, NOW)).toBe(
      "skip-terminal"
    );
  });

  test("the attempts cap is terminal on every claimable branch", () => {
    expect(
      claimDecision(
        { state: "ERROR", retryable: true, attempts: MAX_ATTEMPTS },
        NOW
      )
    ).toBe("skip-attempts-exhausted");
    expect(
      claimDecision(
        {
          state: "PROCESSING",
          attempts: MAX_ATTEMPTS,
          leaseExpiresAt: ts(NOW - 1),
        },
        NOW
      )
    ).toBe("skip-attempts-exhausted");
    expect(
      claimDecision({ attempts: MAX_ATTEMPTS + 5 }, NOW)
    ).toBe("skip-attempts-exhausted");
  });

  test("an unrecognized state refuses rather than guesses", () => {
    // Written by a newer deploy, or by hand. Sending is the irreversible
    // option, so an unknown state does not get it.
    expect(claimDecision({ state: "QUEUED" }, NOW)).toBe("skip-terminal");
  });

  test("the caps are overridable, so the emulator suite can drive them", () => {
    expect(
      claimDecision({ state: "ERROR", retryable: true, attempts: 1 }, NOW, {
        maxAttempts: 1,
      })
    ).toBe("skip-attempts-exhausted");
  });
});

// ---------------------------------------------------------------------------
// 4. Configuration
// ---------------------------------------------------------------------------

describe("configuration", () => {
  const FULL = {
    SES_REGION: "us-east-1",
    SES_ACCESS_KEY_ID: "AKIAEXAMPLE",
    SES_SECRET_ACCESS_KEY: "secret",
    MAIL_FROM: "DataPipe <notifications@pipe.jspsych.org>",
    MAIL_REPLY_TO: "contact@jspsych.org",
  };

  test("a complete environment is missing nothing", () => {
    expect(missingConfigKeys(FULL)).toEqual([]);
  });

  test("MAIL_REPLY_TO is optional -- mail with a bad Reply-To is undeliverable", () => {
    const { MAIL_REPLY_TO, ...noReplyTo } = FULL;
    expect(missingConfigKeys(noReplyTo)).toEqual([]);
    expect(readMailConfig(noReplyTo).replyTo).toBeUndefined();
  });

  test("names every missing key, and blank counts as missing", () => {
    expect(missingConfigKeys({ ...FULL, SES_SECRET_ACCESS_KEY: "   " })).toEqual([
      "SES_SECRET_ACCESS_KEY",
    ]);
    expect(missingConfigKeys({})).toEqual([
      "SES_REGION",
      "SES_ACCESS_KEY_ID",
      "SES_SECRET_ACCESS_KEY",
      "MAIL_FROM",
    ]);
  });

  test("readMailConfig trims, so a stray newline from the .env heredoc cannot break signing", () => {
    const config = readMailConfig({
      ...FULL,
      SES_ACCESS_KEY_ID: "  AKIAEXAMPLE\n",
      MAIL_REPLY_TO: "  contact@jspsych.org  ",
    });
    expect(config.accessKeyId).toBe("AKIAEXAMPLE");
    expect(config.replyTo).toBe("contact@jspsych.org");
  });

  test("the missing-config error name is distinct and permanent", () => {
    // It is the alert handle: it means every notification this deployment
    // sends is being dropped on the floor.
    expect(CONFIG_MISSING_ERROR).toBe("MailConfigMissingError");
    const error = new Error("Missing configuration: SES_REGION");
    error.name = CONFIG_MISSING_ERROR;
    expect(classifySesError(error).retryable).toBe(false);
  });
});

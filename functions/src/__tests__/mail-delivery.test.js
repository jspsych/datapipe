/**
 * @jest-environment node
 */

// Pure coverage for mail-delivery.ts's three decisions.
//
// Everything asserted here is a function of its arguments: the mail
// document -> Resend request-body mapping, the error taxonomy, and the claim
// state machine. No emulator and no network: the transport is one `fetch`
// behind the sender seam, and nothing in this file reaches it. The end-to-end
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
let classifyMailError;
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
    classifyMailError,
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
  apiKey: "re_testtesttest",
  from: "DataPipe <datapipe-notifications@jspsych.org>",
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
// 1. Document -> Resend request body
// ---------------------------------------------------------------------------

describe("buildSendEmailInput", () => {
  test("maps every part of the document onto the request body", () => {
    const input = buildSendEmailInput(mailDoc(), CONFIG);

    expect(input.from).toBe("DataPipe <datapipe-notifications@jspsych.org>");
    expect(input.to).toEqual(["researcher@example.edu"]);
    expect(input.subject).toBe(
      "DataPipe couldn't upload data for Working Memory Span"
    );
    expect(input.text).toBe("The file is not lost.");
    expect(input.html).toBe("<p>The file is not lost.</p>");
  });

  test("spells Reply-To the way the REST API does, not the way the SDK does", () => {
    // The single highest-value assertion in this file. Resend's Node SDK takes
    // `replyTo`; the raw API this code speaks takes `reply_to` and IGNORES
    // unknown keys silently. Get this wrong and there is no error, no bounce
    // and no log line -- just every notification going out with no Reply-To,
    // for however long it takes someone to notice.
    const input = buildSendEmailInput(mailDoc(), CONFIG);
    expect(input.reply_to).toEqual(["contact@jspsych.org"]);
    expect(input).not.toHaveProperty("replyTo");
  });

  test("sends no key at all for a part the document does not have", () => {
    // mail.ts writes `message` WITHOUT an html key for text-only mail, and an
    // empty html string is not the same thing as no html to a mail client.
    const doc = mailDoc({ message: { subject: "s", text: "t" } });
    const input = buildSendEmailInput(doc, CONFIG);

    expect(input.text).toBe("t");
    expect(input).not.toHaveProperty("html");
  });

  test("omits Reply-To when none is configured", () => {
    const { replyTo, ...noReplyTo } = CONFIG;
    const input = buildSendEmailInput(mailDoc(), noReplyTo);

    expect(input).not.toHaveProperty("reply_to");
  });

  test("accepts a bare string recipient as well as an array", () => {
    // mail.ts always writes an array, but the extension contract this replaces
    // also allowed a string, and a hand-written document may well be one.
    const input = buildSendEmailInput(mailDoc({ to: "one@example.edu" }), CONFIG);
    expect(input.to).toEqual(["one@example.edu"]);
  });

  test("drops junk entries rather than handing Resend a null recipient", () => {
    const input = buildSendEmailInput(
      mailDoc({ to: [null, "  keep@example.edu  ", "", 42] }),
      CONFIG
    );
    expect(input.to).toEqual(["keep@example.edu"]);
  });

  test("the body is JSON-serialisable, which is the only form it is ever used in", () => {
    // buildSendEmailInput's output goes straight into JSON.stringify. A value
    // that survives an assertion but not serialisation (undefined, a Date, a
    // Timestamp leaked out of the document) would vanish silently on the wire.
    const input = buildSendEmailInput(mailDoc(), CONFIG);
    expect(JSON.parse(JSON.stringify(input))).toEqual(input);
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
    expect(classifyMailError(thrown).retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Error taxonomy
// ---------------------------------------------------------------------------

describe("classifyMailError", () => {
  // Resend answers a refusal with {name, message, statusCode}; the transport
  // turns that into a MailTransportError whose `name` is Resend's code and
  // whose `status` is the HTTP status. This builds the same shape.
  function apiError(name, status) {
    const error = new Error(`${name} happened`);
    error.name = name;
    if (status !== undefined) error.status = status;
    return error;
  }

  // A node/undici transport failure, which is a different animal: undici
  // reports EVERY one as `TypeError: fetch failed` with the real diagnosis on
  // .cause. Tested in that wrapped form on purpose -- the unwrapped form is
  // not what this code ever receives.
  function transportError(code) {
    const error = new TypeError("fetch failed");
    error.cause = Object.assign(new Error(code), { code });
    return error;
  }

  const table = [
    // [Resend error code, status, retryable, why]
    ["validation_error", 403, false, "sending domain not verified"],
    ["validation_error", 422, false, "malformed request"],
    ["missing_required_field", 422, false, "malformed request"],
    ["missing_api_key", 401, false, "not configured"],
    ["restricted_api_key", 401, false, "key scoped wrong or inactive"],
    ["suspended_api_key", 403, false, "account problem"],
    ["invalid_permission", 403, false, "key lacks the send scope"],
    ["not_found", 404, false, "wrong endpoint -- a deploy fixes it"],
    ["method_not_allowed", 405, false, "wrong endpoint -- a deploy fixes it"],
    ["invalid_idempotent_request", 409, false, "same key, different body"],
    ["rate_limit_exceeded", 429, true, "per-second limit"],
    ["daily_quota_exceeded", 429, true, "plan cap -- 100/day on the free plan"],
    ["monthly_quota_exceeded", 429, true, "plan cap"],
    ["concurrent_idempotent_requests", 409, true, "our own earlier attempt"],
    ["application_error", 500, true, "Resend 5xx"],
    ["service_unavailable", 503, true, "Resend 5xx"],
  ];

  test.each(table)("%s (%d) -> retryable=%s (%s)", (name, status, retryable) => {
    const classified = classifyMailError(apiError(name, status));
    expect(classified.name).toBe(name);
    expect(classified.retryable).toBe(retryable);
  });

  test("unwraps undici's `TypeError: fetch failed` to the real cause", () => {
    // Load-bearing. Undici hides every network error behind that TypeError.
    // Without the unwrap each one classifies as an unrecognised name with no
    // status -- which is TERMINAL -- so a momentary DNS blip would silently
    // become a permanently lost notification.
    expect(classifyMailError(transportError("ECONNREFUSED")).name).toBe(
      "ECONNREFUSED"
    );
    expect(classifyMailError(transportError("ECONNRESET")).name).toBe(
      "ECONNRESET"
    );
    expect(classifyMailError(new TypeError("fetch failed")).name).toBe(
      "UnknownError"
    );
  });

  test("never-connected errors are retryable: nothing can have been sent", () => {
    for (const code of ["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"]) {
      expect(classifyMailError(transportError(code)).retryable).toBe(true);
    }
  });

  test("AMBIGUOUS errors are retryable BECAUSE of the idempotency key", () => {
    // This assertion is inverted from the SES version of this file, and the
    // inversion is the point. Under SESv2 there was no idempotency token, so a
    // request that went out and never answered could not be retried safely:
    // retrying risked a SECOND copy of a notification whose entire value is
    // arriving once, and the code chose to lose the mail instead.
    //
    // Resend takes an Idempotency-Key, and mail-delivery.ts sends the mail
    // document's id as that key on every attempt, so a retry after a timeout
    // is not a second send -- Resend returns the original result. We get the
    // retry AND exactly-once, instead of choosing.
    //
    // IF THIS IS EVER FLIPPED BACK, the reason will be that something can now
    // retry more than 24 hours later, which is when Resend expires the key.
    // Read AMBIGUOUS_ERRORS in mail-delivery.ts before touching it.
    expect(classifyMailError(apiError("TimeoutError")).retryable).toBe(true);
    expect(classifyMailError(apiError("AbortError")).retryable).toBe(true);
    expect(classifyMailError(transportError("ECONNRESET")).retryable).toBe(true);
  });

  test("falls back to the HTTP status when the name is unfamiliar", () => {
    // Resend adds error codes; an unknown one must still be judged.
    expect(classifyMailError(apiError("some_new_throttle", 429)).retryable).toBe(
      true
    );
    expect(classifyMailError(apiError("some_new_outage", 503)).retryable).toBe(
      true
    );
    expect(classifyMailError(apiError("some_new_refusal", 400)).retryable).toBe(
      false
    );
  });

  test("a non-JSON error body still classifies, on status alone", () => {
    // An edge or proxy failure answers HTML, so the transport synthesises the
    // name from the status. 502 from a CDN must not be treated as terminal.
    expect(classifyMailError(apiError("HttpError502", 502)).retryable).toBe(true);
    expect(classifyMailError(apiError("HttpError400", 400)).retryable).toBe(false);
  });

  test("an unknown, unnamed, statusless error does not consume the retry budget", () => {
    // More likely a defect on our side than a blip at Resend.
    expect(classifyMailError(new Error("boom")).retryable).toBe(false);
    expect(classifyMailError(new Error("boom")).name).toBe("UnknownError");
    expect(classifyMailError(undefined).name).toBe("UnknownError");
    expect(classifyMailError("just a string").message).toBe("Unknown error");
  });

  test("reads a node-style `code` when there is no useful name", () => {
    const error = new Error("socket hang up");
    error.code = "ECONNRESET";
    expect(classifyMailError(error).name).toBe("ECONNRESET");
  });

  test("never carries a stack, and truncates the message", () => {
    const error = apiError("validation_error", 422);
    error.message = "x".repeat(5000);
    const classified = classifyMailError(error);
    expect(classified).toEqual({
      name: "validation_error",
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
    RESEND_API_KEY: "re_testtesttest",
    MAIL_FROM: "DataPipe <datapipe-notifications@jspsych.org>",
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
    expect(missingConfigKeys({ ...FULL, RESEND_API_KEY: "   " })).toEqual([
      "RESEND_API_KEY",
    ]);
    expect(missingConfigKeys({})).toEqual(["RESEND_API_KEY", "MAIL_FROM"]);
  });

  test("readMailConfig trims, so a stray newline from the .env heredoc cannot 401", () => {
    // A trailing newline inside a bearer token is not a visible problem: it is
    // a 401 that looks exactly like a wrong key.
    const config = readMailConfig({
      ...FULL,
      RESEND_API_KEY: "  re_testtesttest\n",
      MAIL_REPLY_TO: "  contact@jspsych.org  ",
    });
    expect(config.apiKey).toBe("re_testtesttest");
    expect(config.replyTo).toBe("contact@jspsych.org");
  });

  test("the missing-config error name is distinct and permanent", () => {
    // It is the alert handle: it means every notification this deployment
    // sends is being dropped on the floor.
    expect(CONFIG_MISSING_ERROR).toBe("MailConfigMissingError");
    const error = new Error("Missing configuration: RESEND_API_KEY");
    error.name = CONFIG_MISSING_ERROR;
    expect(classifyMailError(error).retryable).toBe(false);
  });
});

// Pure copy tests for the first-failure notification.
//
// No emulator, no admin app, no network: functions/src/email/upload-failure-copy.ts
// has only `import type` dependencies, so the compiled module it imports below
// has no runtime imports at all and never reaches app.js. That is the whole
// reason the wording lives in its own module -- these are the assertions that
// would otherwise need a Firestore transaction to reach.
//
// Imports the COMPILED module (functions/lib/), so `npm --prefix functions run
// build` must run first. Same convention as metadata-derived-files.test.js.

import {
  buildUploadFailureEmail,
  actionLine,
  reasonLine,
  providerDisplayName,
  experimentUrl,
  ACCOUNT_URL,
  FAQ_URL,
  APP_BASE_URL,
} from "../../lib/email/upload-failure-copy.js";

const base = {
  experimentID: "abc123",
  title: "Working Memory Span",
  storageProvider: "gdrive",
  providerErrorCode: "UNAVAILABLE",
  failureCount: 1,
};

describe("subject line", () => {
  test("names the experiment", () => {
    const { subject } = buildUploadFailureEmail(base);
    expect(subject).toContain("Working Memory Span");
    expect(subject).toContain("couldn't upload");
  });

  test("falls back to a generic subject when the experiment has no title", () => {
    // Nothing guarantees a `title` on an older experiment document, and a
    // subject reading `for ""` would be worse than one that says nothing.
    for (const title of [undefined, null, "", "   "]) {
      const { subject } = buildUploadFailureEmail({ ...base, title });
      expect(subject).toBe(
        "DataPipe couldn't upload a data file for your experiment"
      );
      expect(subject).not.toContain('""');
    }
  });
});

describe("body essentials", () => {
  test("carries the study, the provider, the reassurance and both links", () => {
    const { text } = buildUploadFailureEmail(base);

    expect(text).toContain("Working Memory Span");
    expect(text).toContain("Google Drive");
    // The single most important sentence in the mail.
    expect(text).toContain("The file is not lost.");
    // The retry horizon is owner-confirmed: five attempts, ~31 hours.
    expect(text).toContain("five attempts over about 31 hours");
    expect(text).toContain(`${APP_BASE_URL}/admin/abc123`);
    expect(text).toContain(ACCOUNT_URL);
    // Service-critical transactional mail: the only control offered is
    // changing the address, and there is deliberately no unsubscribe link.
    expect(text).not.toMatch(/unsubscribe/i);
  });

  test("says the researcher will only be mailed once per episode", () => {
    const { text } = buildUploadFailureEmail(base);
    expect(text).toContain("only email you once about this");
    expect(text).toContain("not once per file");
  });

  test("html body carries the same links and is valid-ish markup", () => {
    const { html } = buildUploadFailureEmail(base);
    expect(html).toContain(`href="${experimentUrl("abc123")}"`);
    expect(html).toContain("<strong>The file is not lost.</strong>");
    expect(html).toContain(ACCOUNT_URL);
  });

  test("escapes a researcher-supplied title in the html body", () => {
    // `title` is typed by the researcher and reaches the mail unfiltered.
    const { html, subject } = buildUploadFailureEmail({
      ...base,
      title: '<script>alert("x")</script> & co',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; co");
    // The plaintext subject is not markup and is left alone.
    expect(subject).toContain("<script>");
  });
});

describe("failure count", () => {
  test("omits the burst line for a single file", () => {
    // The mail is only composed on the FIRST failure of an episode, so the
    // count is normally 1 -- "1 file is waiting so far" would be noise.
    const { text } = buildUploadFailureEmail({ ...base, failureCount: 1 });
    expect(text).not.toMatch(/files from this experiment are waiting/);
  });

  test("includes the burst line when more than one file has failed", () => {
    const { text } = buildUploadFailureEmail({ ...base, failureCount: 4 });
    expect(text).toContain("4 files from this experiment are waiting so far");
  });

  test("tolerates an absent count", () => {
    const { text } = buildUploadFailureEmail({ ...base, failureCount: undefined });
    expect(text).not.toMatch(/undefined/);
    expect(text).not.toMatch(/NaN/);
  });
});

describe("provider display names", () => {
  test.each([
    ["osf", "OSF"],
    ["gdrive", "Google Drive"],
    ["figshare", "Figshare"],
    ["dataverse", "Dataverse"],
    ["zenodo", "Zenodo"],
  ])("%s renders as %s", (id, expected) => {
    expect(providerDisplayName(id)).toBe(expected);
    expect(buildUploadFailureEmail({ ...base, storageProvider: id }).text).toContain(expected);
  });

  test("an absent or unknown provider gets a generic phrase, never a raw id", () => {
    // Legacy OSF experiments have no storageProvider field at all
    // (interfaces.ts: the field is additive).
    expect(providerDisplayName(undefined)).toBe("your storage provider");
    expect(providerDisplayName(null)).toBe("your storage provider");
    expect(providerDisplayName("wat")).toBe("your storage provider");
    expect(buildUploadFailureEmail({ ...base, storageProvider: "wat" }).text).not.toContain(
      "wat"
    );
  });
});

describe("reason mapping", () => {
  // Every member of ProviderErrorCode (functions/src/providers/types.ts) maps
  // to a researcher-facing clause. A code added there without a line here
  // would silently fall back to the generic wording.
  test.each([
    ["AUTH_EXPIRED", "your storage connection needs to be reconnected"],
    ["QUOTA_EXCEEDED", "your storage account is out of room"],
    ["RATE_LIMITED", "the provider is asking us to slow down"],
    ["UNAVAILABLE", "the provider was unreachable"],
    ["CONTENTION", "another write to the same folder was in progress"],
    ["NAME_CONFLICT", "a file with that name already exists"],
  ])("%s maps to its own line", (code, line) => {
    expect(reasonLine(code)).toBe(line);
    expect(buildUploadFailureEmail({ ...base, providerErrorCode: code }).text).toContain(
      `What went wrong: ${line}.`
    );
  });

  test("an absent or unrecognized code falls back", () => {
    // The larger population, not an edge case: only a provider WriteResult
    // carries a code, so every failure that never reached the provider
    // (token resolution, cache trouble, an unreadable payload) lands here.
    const fallback = "the upload did not complete";
    expect(reasonLine(undefined)).toBe(fallback);
    expect(reasonLine(null)).toBe(fallback);
    expect(reasonLine("SOMETHING_NEW")).toBe(fallback);

    const { text } = buildUploadFailureEmail({ ...base, providerErrorCode: null });
    expect(text).toContain(fallback);
    // With no code to explain, the mail must still leave them somewhere
    // useful: the queue panel has the per-file detail.
    expect(text).toContain("queue panel");
  });
});

describe("what to check", () => {
  test("AUTH_EXPIRED on a live provider says reconnect, and where", () => {
    const line = actionLine("AUTH_EXPIRED", "zenodo");
    expect(line).toContain("Reconnect Zenodo");
    expect(line).toContain(ACCOUNT_URL);
    expect(line).not.toContain(FAQ_URL);
  });

  test.each([["osf"], [undefined], [null]])(
    "AUTH_EXPIRED on a legacy OSF experiment (storageProvider=%s) points at the FAQ, not at reconnecting",
    (provider) => {
      // OSF is retiring the projects feature DataPipe writes into, so
      // "reconnect your provider" would send the researcher to repair
      // something that is going away. An absent storageProvider IS the legacy
      // OSF shape.
      const line = actionLine("AUTH_EXPIRED", provider);
      expect(line).toContain("OSF");
      expect(line).toContain(FAQ_URL);
      expect(line).not.toMatch(/^Reconnect/);

      const { text } = buildUploadFailureEmail({
        ...base,
        storageProvider: provider,
        providerErrorCode: "AUTH_EXPIRED",
      });
      expect(text).toContain(FAQ_URL);
    }
  );

  test("the self-healing codes say there is nothing to do", () => {
    for (const code of ["CONTENTION", "UNAVAILABLE", "RATE_LIMITED"]) {
      expect(actionLine(code, "dataverse")).toContain("Nothing to do right now");
    }
  });

  test("QUOTA_EXCEEDED and NAME_CONFLICT ask for something specific", () => {
    expect(actionLine("QUOTA_EXCEEDED", "zenodo")).toContain("Free up room in Zenodo");
    expect(actionLine("NAME_CONFLICT", "gdrive")).toContain("Check Google Drive");
  });
});

describe("urls", () => {
  test("experiment link points at the admin page for the id", () => {
    expect(experimentUrl("xy-9")).toBe("https://pipe.jspsych.org/admin/xy-9");
    expect(ACCOUNT_URL).toBe("https://pipe.jspsych.org/admin/account");
    expect(FAQ_URL).toBe("https://pipe.jspsych.org/faq");
  });
});

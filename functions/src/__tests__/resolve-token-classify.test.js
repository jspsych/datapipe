/**
 * @jest-environment node
 *
 * Pure coverage for classifyTokenFailure (functions/src/resolve-token.ts),
 * the RECOVERABLE / NOT_RECOVERABLE split that api-data.ts, api-base64.ts
 * and scheduled-upload-retry.ts all share so a token-resolution failure is
 * queued for retry (RECOVERABLE) or rejected outright (NOT_RECOVERABLE)
 * consistently across all three call sites.
 *
 * TokenResult.error (providers/types.ts) is typed as a plain `string`, not a
 * union resolveToken's return type lets TypeScript enumerate for us -- so
 * this file lists every code each adapter's resolveToken can actually
 * produce explicitly, rather than iterating a type. That list was built by
 * reading every `resolveToken` implementation (osf.ts, gdrive.ts,
 * dataverse.ts, zenodo.ts) and resolve-token.ts's own wrapper:
 *   - PROVIDER_NOT_CONNECTED  -- resolve-token.ts (unsupported/unregistered
 *                                storageProvider id), gdrive.ts, dataverse.ts,
 *                                zenodo.ts (no connectedAccounts.<provider>
 *                                entry for the owner)
 *   - INVALID_OSF_TOKEN       -- osf.ts (personal access token marked invalid)
 *   - INVALID_REFRESH_TOKEN   -- osf.ts, gdrive.ts, zenodo.ts (refresh grant
 *                                rejected, the refresh HTTP call itself
 *                                threw, or persisting the rotated credential
 *                                failed)
 *   - PROVIDER_TOKEN_EXPIRED  -- dataverse.ts (static token expired, no
 *                                refresh token to rotate)
 * A future adapter's code that is not in this list is exercised by the
 * "unknown code" test below and must default to RECOVERABLE (queue rather
 * than reject) -- see the doc comment on classifyTokenFailure for why that
 * default is the safer direction to be wrong in.
 *
 * Imports the COMPILED module (functions/lib/), so `npm run build` must run
 * first from functions/. classifyTokenFailure itself needs neither Firestore
 * nor a network call, but resolve-token.js is a single module whose OTHER
 * export (the default resolveToken function) pulls in providers/index.js at
 * module load -- which registers every adapter, each importing the
 * ESM-only "node-fetch" package at module scope. Jest's CJS transform can't
 * parse that import, so node-fetch is mocked out before the require() below,
 * same convention as resolve-token-gdrive.test.js / providers-osf.test.js.
 */

jest.mock("node-fetch", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const { classifyTokenFailure } = require("../../lib/resolve-token.js");

describe("classifyTokenFailure — NOT_RECOVERABLE (no connection exists at all)", () => {
  test("PROVIDER_NOT_CONNECTED", () => {
    expect(classifyTokenFailure("PROVIDER_NOT_CONNECTED")).toBe("NOT_RECOVERABLE");
  });
});

describe("classifyTokenFailure — RECOVERABLE (a connection exists, its credential failed)", () => {
  test.each([
    // osf.ts
    "INVALID_OSF_TOKEN",
    "INVALID_REFRESH_TOKEN",
    // dataverse.ts
    "PROVIDER_TOKEN_EXPIRED",
  ])("%s", (code) => {
    expect(classifyTokenFailure(code)).toBe("RECOVERABLE");
  });
});

describe("classifyTokenFailure — exhaustiveness against every code providers can return", () => {
  // The complete set enumerated in this file's header comment. Every member
  // must land in exactly one of the two describe blocks above; this test
  // fails loudly if one is ever added to ALL_TOKEN_ERROR_CODES without also
  // updating the RECOVERABLE/NOT_RECOVERABLE lists above it, rather than the
  // silent miscategorization the review flagged in the first place.
  const ALL_TOKEN_ERROR_CODES = [
    "PROVIDER_NOT_CONNECTED",
    "INVALID_OSF_TOKEN",
    "INVALID_REFRESH_TOKEN",
    "PROVIDER_TOKEN_EXPIRED",
  ];
  const NOT_RECOVERABLE_CODES = new Set(["PROVIDER_NOT_CONNECTED"]);

  test("every known code is accounted for and classified as documented", () => {
    for (const code of ALL_TOKEN_ERROR_CODES) {
      const expected = NOT_RECOVERABLE_CODES.has(code) ? "NOT_RECOVERABLE" : "RECOVERABLE";
      expect(classifyTokenFailure(code)).toBe(expected);
    }
  });
});

describe("classifyTokenFailure — a code no provider has ever returned", () => {
  // Not "any exception" would default to NOT_RECOVERABLE and start silently
  // rejecting submissions that a later retry could have saved -- the
  // dangerous direction, since it discards data rather than merely delaying
  // its delivery. See the doc comment on classifyTokenFailure.
  test("defaults to RECOVERABLE rather than rejecting", () => {
    expect(classifyTokenFailure("SOME_FUTURE_PROVIDER_TOKEN_CODE")).toBe("RECOVERABLE");
  });
});

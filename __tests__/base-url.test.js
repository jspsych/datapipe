/**
 * @jest-environment node
 *
 * The deployment URL shown in the API reference and threaded into the code
 * samples (#246). The test site used to hand out samples that wrote to
 * production, because nothing read NEXT_PUBLIC_BASE_URL.
 */

import {
  PRODUCTION_BASE_URL,
  resolveBaseURL,
  sampleBaseURL,
} from "../lib/base-url";

describe("resolveBaseURL", () => {
  it("uses the configured deployment", () => {
    expect(resolveBaseURL("https://datapipe-test.web.app")).toBe("https://datapipe-test.web.app");
  });

  it("drops trailing slashes so `${base}/api/...` never doubles one", () => {
    expect(resolveBaseURL("https://datapipe-test.web.app//")).toBe("https://datapipe-test.web.app");
  });

  it("falls back to production when unset or blank", () => {
    expect(resolveBaseURL(undefined)).toBe(PRODUCTION_BASE_URL);
    expect(resolveBaseURL("")).toBe(PRODUCTION_BASE_URL);
    expect(resolveBaseURL("  / ")).toBe(PRODUCTION_BASE_URL);
  });
});

describe("sampleBaseURL", () => {
  it("adds no override on production, where the packages' default is right", () => {
    expect(sampleBaseURL(PRODUCTION_BASE_URL)).toBeNull();
  });

  it("names every other deployment explicitly", () => {
    expect(sampleBaseURL("https://datapipe-test.web.app")).toBe("https://datapipe-test.web.app");
  });
});

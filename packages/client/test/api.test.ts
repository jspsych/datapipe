import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBaseURL, setBaseURL } from "../src/http.js";
import { getCondition, saveBase64Data, saveData } from "../src/api.js";

function mockFetch(impl: (url: string, init?: RequestInit) => any) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const result = impl(url, init);
    if (result instanceof Error) throw result;
    return {
      ok: result?.ok ?? true,
      status: result?.status ?? 200,
      json: async () => result,
    };
  });
  (globalThis as any).fetch = fn;
  return fn;
}

beforeEach(() => {
  setBaseURL("");
  // Force the uncompressed fallback path deterministically, regardless of
  // whether the test runtime happens to provide CompressionStream --
  // keeps body assertions (JSON.parse on a plain string) meaningful, and
  // matches what many of the researchers this library ships to will
  // actually see (see gzipCompress's own warning in ./http.ts).
  vi.stubGlobal("CompressionStream", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as any).fetch;
});

describe("base URL", () => {
  it("defaults to production", () => {
    expect(getBaseURL()).toBe("https://pipe.jspsych.org");
  });

  it("can be pointed at another deployment", async () => {
    setBaseURL("https://datapipe-test.web.app");
    const fetchMock = mockFetch(() => ({ message: "Success" }));

    await saveData({ experimentID: "EXP12345", filename: "p01.csv", data: "a,b\n1,2\n" });

    expect(fetchMock.mock.calls[0][0]).toBe("https://datapipe-test.web.app/api/data/");
  });

  it("does not double the slash when the base URL has a trailing one", async () => {
    setBaseURL("https://datapipe-test.web.app/");
    const fetchMock = mockFetch(() => ({ condition: 1 }));

    await getCondition({ experimentID: "EXP12345" });

    expect(fetchMock.mock.calls[0][0]).toBe("https://datapipe-test.web.app/api/condition/");
  });

  it("collapses a run of trailing slashes", async () => {
    // Pins the behaviour of the hand-rolled loop that replaced
    // `url.replace(/\/+$/, "")`, which CodeQL flags as js/polynomial-redos.
    setBaseURL("https://datapipe-test.web.app///");
    const fetchMock = mockFetch(() => ({ condition: 1 }));

    await getCondition({ experimentID: "EXP12345" });

    expect(fetchMock.mock.calls[0][0]).toBe("https://datapipe-test.web.app/api/condition/");
  });

  it("leaves interior slashes alone and survives an all-slash string", async () => {
    setBaseURL("https://datapipe-test.web.app/a/b/");
    const fetchMock = mockFetch(() => ({ condition: 1 }));
    await getCondition({ experimentID: "EXP12345" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://datapipe-test.web.app/a/b/api/condition/");

    // Degenerate, but it must not hang or throw: stripping everything leaves
    // an empty base, and the default takes over.
    setBaseURL("///");
    expect(getBaseURL()).toBe("https://pipe.jspsych.org");
  });

  it("lets a single call override the global setting", async () => {
    const fetchMock = mockFetch(() => ({ message: "Success" }));

    await saveBase64Data({
      experimentID: "EXP12345",
      filename: "a.wav",
      data: "AAAA",
      baseURL: "https://other.example",
    });

    expect(fetchMock.mock.calls[0][0]).toBe("https://other.example/api/base64/");
  });
});

describe("saveData", () => {
  it("sends no sessionId when the call did not stream", async () => {
    const fetchMock = mockFetch(() => ({ message: "Success" }));

    await saveData({ experimentID: "EXP12345", filename: "p01.csv", data: "a,b\n1,2\n" });

    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body).toEqual({
      experimentID: "EXP12345",
      filename: "p01.csv",
      data: "a,b\n1,2\n",
    });
  });

  it("sends the full data string alongside the sessionId when it did", async () => {
    // The staged copy is NOT the submission. The caller still holds the
    // dataset, so it is sent exactly as before; the id only tells DataPipe
    // which staged copy this submission supersedes.
    const fetchMock = mockFetch(() => ({ message: "Success" }));

    await saveData({
      experimentID: "EXP12345",
      filename: "p01.csv",
      data: "a,b\n1,2\n",
      sessionId: "SESSION123",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.data).toBe("a,b\n1,2\n");
    expect(body.sessionId).toBe("SESSION123");
  });

  it("throws on a missing required parameter", async () => {
    await expect(saveData({ experimentID: "", filename: "p01.csv", data: "x" })).rejects.toThrow();
  });

  describe("the ok/status/body result", () => {
    it("is ok on an ordinary success", async () => {
      mockFetch(() => ({ message: "Success" }));

      const result = await saveData({ experimentID: "EXP12345", filename: "p01.csv", data: "x" });

      expect(result).toEqual({ ok: true, status: 200, body: { message: "Success" } });
    });

    it("treats a queued submission (202) as ok", async () => {
      // DataPipe answers error: null and holds the copy durably for retry.
      mockFetch(() => ({
        ok: true,
        status: 202,
        error: null,
        message: "Data received. The upload will be retried automatically.",
      }));

      const result = await saveData({ experimentID: "EXP12345", filename: "p01.csv", data: "x" });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(202);
    });

    it("is not ok when the server reports an error", async () => {
      mockFetch(() => ({ ok: false, status: 400, error: "OSF_FILE_EXISTS", message: "exists" }));

      const result = await saveData({ experimentID: "EXP12345", filename: "p01.csv", data: "x" });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
    });

    it("is not ok, with status 0, on a network failure", async () => {
      // A network failure must never read as success -- this is the bug
      // isSuccessfulResult exists to prevent from regressing.
      (globalThis as any).fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      const result = await saveData({ experimentID: "EXP12345", filename: "p01.csv", data: "x" });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
      expect(result.body).toBeInstanceOf(Error);
    });
  });
});

describe("saveBase64Data", () => {
  it("posts the base64 payload", async () => {
    const fetchMock = mockFetch(() => ({ message: "Success" }));

    const result = await saveBase64Data({ experimentID: "EXP12345", filename: "a.wav", data: "AAAA" });

    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body).toEqual({ experimentID: "EXP12345", filename: "a.wav", data: "AAAA" });
    expect(result.ok).toBe(true);
  });

  it("throws on a missing required parameter", async () => {
    await expect(
      saveBase64Data({ experimentID: "EXP12345", filename: "", data: "AAAA" })
    ).rejects.toThrow();
  });
});

describe("getCondition", () => {
  it("treats condition 0 as a success", async () => {
    mockFetch(() => ({ condition: 0 }));

    const condition = await getCondition({ experimentID: "EXP12345" });

    expect(condition).toBe(0);
  });

  it("resolves a positive condition", async () => {
    mockFetch(() => ({ condition: 3 }));

    const condition = await getCondition({ experimentID: "EXP12345" });

    expect(condition).toBe(3);
  });

  // A condition decides which timeline a participant runs, so unlike staging
  // -- where a lost trial is still submitted at the end -- there is no safe
  // value to fall back to. Resolving with one would send the participant
  // through the wrong experiment, or an empty one, with nothing to show that
  // anything had gone wrong. Every failure below has to reach the caller.
  it("throws, naming the reason, when the request is refused", async () => {
    mockFetch(() => ({
      error: "CONDITION_ASSIGNMENT_NOT_ACTIVE",
      message: "Condition assignment is not active for this experiment",
    }));

    await expect(getCondition({ experimentID: "EXP12345" })).rejects.toThrow(
      /CONDITION_ASSIGNMENT_NOT_ACTIVE/
    );
  });

  it("throws on a network failure, keeping the cause", async () => {
    const failure = new TypeError("Failed to fetch");
    (globalThis as any).fetch = vi.fn().mockRejectedValue(failure);

    await expect(getCondition({ experimentID: "EXP12345" })).rejects.toThrow(
      /could not reach DataPipe/
    );
    await expect(getCondition({ experimentID: "EXP12345" })).rejects.toMatchObject({
      cause: failure,
    });
  });

  it("throws when the response carries no condition", async () => {
    mockFetch(() => ({ message: "Success" }));

    await expect(getCondition({ experimentID: "EXP12345" })).rejects.toThrow(
      /did not contain a condition/
    );
  });

  it("throws on a missing required parameter", async () => {
    await expect(getCondition({ experimentID: "" })).rejects.toThrow();
  });
});

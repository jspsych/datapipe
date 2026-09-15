// The plain-HTTP half of datapipe-client: talking to DataPipe's REST API
// (POST /api/data, /api/base64, /api/condition, /api/session). No Firebase
// here -- that is session.ts's job, for the staging tier only.

// The deployment every request goes to unless overridden.
//
// Configurable because it has to be: nothing here can be exercised against
// DataPipe's test deployment while the URL is hardcoded into every fetch
// call, which would mean every change is first tried in production against
// real researchers' experiments.
const DEFAULT_BASE_URL = "https://pipe.jspsych.org";
let baseURL = DEFAULT_BASE_URL;

/**
 * Point every request at a different DataPipe deployment. An empty string
 * restores the default.
 *
 * The fallback tests what normalizing PRODUCED, not what the caller passed.
 * `"/"` and `"///"` are truthy but normalize to `""`, and an empty base makes
 * `endpoint()` return `/api/data/` -- a relative URL, so every submission
 * would quietly go to the experiment's own host instead of DataPipe, and the
 * researcher would be left reading 404s from their own server.
 */
export function setBaseURL(url: string): void {
  baseURL = (url ? normalizeBaseURL(url) : "") || DEFAULT_BASE_URL;
}

/** The deployment requests currently go to. */
export function getBaseURL(): string {
  return baseURL;
}

/**
 * Strip any trailing slash so `${base}/api/data/` never doubles it.
 *
 * Deliberately a loop and not `url.replace(/\/+$/, "")`. CodeQL flags that
 * regex as js/polynomial-redos: in the general backtracking model, every
 * starting position in a run of slashes matches `/+` to the end and then
 * fails the anchor. V8 appears to optimise the anchored case -- a 60k-slash
 * string showed no measurable slowdown -- and nothing hostile reaches this
 * anyway, since the value is the researcher's own baseURL and not participant
 * input. So this is not a fix for an observed problem. It is here because the
 * loop is provably linear, reads no worse, and costs less than re-arguing the
 * alert every time someone scans this package.
 */
export function normalizeBaseURL(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return url.slice(0, end);
}

export function endpoint(path: string, override?: string): string {
  return `${normalizeBaseURL(override || baseURL)}/api/${path}/`;
}

/**
 * Did an action succeed?
 *
 * `result.error ? false : true` looks right and is wrong twice over:
 *
 *  - A NETWORK FAILURE READ AS SUCCESS. A failed fetch is caught and the
 *    thrown Error itself is what gets evaluated here, and an Error has no
 *    `.error` property -- so a participant whose data never left the browser
 *    would be recorded as a success.
 *  - undefined.error THROWS. A response DataPipe answers with an error (e.g.
 *    condition assignment switched off) can lack the field a naive caller
 *    expects, and reading `.error` off `undefined` throws.
 *
 * A number is a success (a condition, including condition 0). A 202 counts:
 * DataPipe answers `error: null` when it has queued the data for retry, and
 * it holds that copy durably. This exact function, with this exact set of
 * cases, previously lived in @jspsych-contrib/plugin-pipe and fixed a real
 * bug there -- do not regress it.
 */
export function isSuccessfulResult(result: unknown): boolean {
  if (result === undefined || result === null) return false;
  if (result instanceof Error) return false;
  if (typeof result === "object" && (result as { error?: unknown }).error) return false;
  return true;
}

/**
 * Compress a string using the browser's/runtime's CompressionStream API
 * (gzip). Returns a gzipped Blob, or null if CompressionStream is not
 * supported, in which case the caller falls back to an uncompressed request.
 */
export async function gzipCompress(data: string): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined") {
    console.warn(
      "datapipe: CompressionStream API is not supported in this environment. " +
        "Data will be sent uncompressed. Consider using a modern browser " +
        "(Chrome 80+, Edge 80+, Safari 16.4+, Firefox 113+) to enable compression."
    );
    return null;
  }

  const encoder = new TextEncoder();
  const stream = new Blob([encoder.encode(data)]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
  return new Response(compressedStream).blob();
}

/** Send a POST request, gzip-compressing the body when possible. */
export async function sendRequest(
  url: string,
  body: Record<string, unknown>,
  compress: boolean
): Promise<Response> {
  const jsonString = JSON.stringify(body);

  if (compress) {
    try {
      const compressed = await gzipCompress(jsonString);
      if (compressed) {
        return fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
            Accept: "*/*",
          },
          body: compressed,
        });
      }
    } catch (error) {
      console.warn("datapipe: Compression failed. Falling back to uncompressed upload.", error);
    }
  }

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "*/*",
    },
    body: jsonString,
  });
}

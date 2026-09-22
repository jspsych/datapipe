// The DataPipe deployment this build serves, for the URLs shown in the API
// reference and threaded into the copy-paste code samples.
//
// Both deploy workflows set NEXT_PUBLIC_BASE_URL (firebase-deploy.yml ->
// https://pipe.jspsych.org, firebase-deploy-test.yml ->
// https://datapipe-test.web.app). Before this module nothing read it, so the
// test deployment handed testers samples that fell through to
// datapipe-client's built-in production URL: copy one, run it, and the data
// landed in the live service, against real researchers' experiments.
//
// Next.js inlines NEXT_PUBLIC_* at build time, so this must stay a literal
// `process.env.NEXT_PUBLIC_BASE_URL` reference (no dynamic lookup), and the
// value is fixed per build, not per request. The production URL is the
// fallback: an unconfigured build (a self-host that never set the var) is
// describing the hosted service.

export const PRODUCTION_BASE_URL = "https://pipe.jspsych.org";

export function resolveBaseURL(configured) {
  let url = (configured || "").trim();
  while (url.endsWith("/")) url = url.slice(0, -1);
  return url || PRODUCTION_BASE_URL;
}

export const BASE_URL = resolveBaseURL(process.env.NEXT_PUBLIC_BASE_URL);

// The URL the code samples must pass explicitly, or null when the published
// packages' own default already points at this deployment. Production samples
// stay free of an option researchers would only copy around; every other
// build names its deployment, because the npm packages cannot know it.
export function sampleBaseURL(baseURL) {
  return baseURL === PRODUCTION_BASE_URL ? null : baseURL;
}

export const SAMPLE_BASE_URL = sampleBaseURL(BASE_URL);

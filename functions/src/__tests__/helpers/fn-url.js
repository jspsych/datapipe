// Shared emulator-URL builder for the dashboardapi consolidation
// (functions/src/dashboard-api.ts). Sixteen low-traffic dashboard endpoints
// that used to each deploy as their own Cloud Function are now dispatched
// from ONE function, keyed on req.path -- so a test that used to build
// http://localhost:5001/datapipe-test/us-central1/createexperiment now has to
// hit http://localhost:5001/datapipe-test/us-central1/dashboardapi/api/createexperiment
// instead. fnUrl(apiPath) is the one place that knows which of those two
// shapes a given hosting-facing path (as it appears in firebase.json's
// rewrite `source`) resolves to, so individual suites don't each hardcode it.
//
// Respects the same FUNCTIONS_HOST / PROJECT_ID conventions the emulator test
// files already use (see e.g. staging-emulator.test.js, session-id-
// validation-emulator.test.js), defaulting to the values every suite in this
// repo assumes when they are unset.

const FUNCTIONS_HOST = process.env.FUNCTIONS_HOST || "localhost:5001";
const PROJECT_ID = process.env.PROJECT_ID || "datapipe-test";
const REGION = "us-central1";

// Mirrors firebase.json's hosting.rewrites. Endpoints merged into
// dashboardapi carry `merged: true`; everything else keeps its own function
// name, exactly as firebase.json still routes it.
const ROUTES = {
  // -- merged into dashboardapi --
  "/api/createexperiment": { fn: "dashboardapi", merged: true },
  "/api/connectprovider": { fn: "dashboardapi", merged: true },
  "/api/connectstatictokenprovider": { fn: "dashboardapi", merged: true },
  "/api/disconnectprovider": { fn: "dashboardapi", merged: true },
  "/api/deleteaccount": { fn: "dashboardapi", merged: true },
  "/api/generateoauthstate": { fn: "dashboardapi", merged: true },
  "/api/oauth2callback": { fn: "dashboardapi", merged: true },
  "/api/saveosftoken": { fn: "dashboardapi", merged: true },
  "/api/getosftoken": { fn: "dashboardapi", merged: true },
  "/api/getprovideraccesstoken": { fn: "dashboardapi", merged: true },
  "/api/providersetupwarnings": { fn: "dashboardapi", merged: true },
  "/api/checkemailconflict": { fn: "dashboardapi", merged: true },
  "/api/sendcontactemailverification": { fn: "dashboardapi", merged: true },
  "/api/verifycontactemail": { fn: "dashboardapi", merged: true },
  "/api/oauth2regenerate": { fn: "dashboardapi", merged: true },
  // ensureDerivedPaths landed on `test` via PR #249, after the other 15 were
  // merged -- same treatment, added as a 16th route.
  "/api/ensurederivedpaths": { fn: "dashboardapi", merged: true },
  // -- untouched, still their own function --
  "/api/data": { fn: "apidata" },
  "/api/session": { fn: "apisessionstart" },
  "/api/condition": { fn: "apicondition" },
  "/api/base64": { fn: "apibase64" },
  "/api/queuestatus": { fn: "apiqueuestatus" },
  "/api/finalize": { fn: "apifinalize" },
};

// apiPath: a hosting-facing path exactly as firebase.json's rewrite `source`
// spells it, e.g. "/api/createexperiment".
export function fnUrl(apiPath) {
  const route = ROUTES[apiPath];
  if (!route) {
    throw new Error(`fn-url: no route registered for "${apiPath}" -- add it to ROUTES in helpers/fn-url.js`);
  }
  const base = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/${route.fn}`;
  return route.merged ? `${base}${apiPath}` : base;
}

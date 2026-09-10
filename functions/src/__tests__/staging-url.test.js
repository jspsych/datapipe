/**
 * @jest-environment node
 *
 * Which database a session stages into (stagingDatabaseURL in staging.ts).
 *
 * The address is handed to every participant's browser, so a wrong one fails
 * every session start on a deployment. It used to be derived from the project
 * id alone, which is right only for an instance in us-central1 -- anywhere
 * else the instance lives at <name>.<region>.firebasedatabase.app.
 */

const { stagingDatabaseURL } = require("../../lib/staging.js");

const ENV_KEYS = [
  "STAGING_DATABASE_URL",
  "FIREBASE_CONFIG",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  ENV_KEYS.forEach((k) => delete process.env[k]);
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
});

const config = (fields) => JSON.stringify({ projectId: "datapipe-test", ...fields });

describe("stagingDatabaseURL", () => {
  it("uses the real instance address from FIREBASE_CONFIG, including a regional one", () => {
    // What `firebase deploy` injects, fetched from the Management API. The
    // derived guess would have been https://datapipe-test-default-rtdb.firebaseio.com.
    process.env.GCLOUD_PROJECT = "datapipe-test";
    process.env.FIREBASE_CONFIG = config({
      databaseURL: "https://datapipe-test-default-rtdb.europe-west1.firebasedatabase.app",
    });

    expect(stagingDatabaseURL()).toBe(
      "https://datapipe-test-default-rtdb.europe-west1.firebasedatabase.app"
    );
  });

  it("uses the emulator address the functions emulator injects", () => {
    process.env.FIREBASE_CONFIG = config({
      databaseURL: "http://127.0.0.1:9000/?ns=datapipe-test-default-rtdb",
    });

    expect(stagingDatabaseURL()).toBe("http://127.0.0.1:9000/?ns=datapipe-test-default-rtdb");
  });

  it("lets an explicit override win over FIREBASE_CONFIG", () => {
    process.env.STAGING_DATABASE_URL = "https://override.firebaseio.com";
    process.env.FIREBASE_CONFIG = config({ databaseURL: "https://other.firebaseio.com" });

    expect(stagingDatabaseURL()).toBe("https://override.firebaseio.com");
  });

  it.each([
    ["an empty databaseURL, as reported for a project with no instance", config({ databaseURL: "" })],
    ["no databaseURL at all", config({})],
    ["malformed JSON", "{not json"],
    ["a file path, which the Admin SDK also accepts", "/workspace/firebase-config.json"],
  ])("falls back to the derived address given %s", (_label, firebaseConfig) => {
    // None of these may throw: this runs on the session-start path, and a
    // throw there is a 503 for a reason unrelated to the database.
    process.env.GCLOUD_PROJECT = "datapipe-test";
    process.env.FIREBASE_CONFIG = firebaseConfig;

    expect(stagingDatabaseURL()).toBe("https://datapipe-test-default-rtdb.firebaseio.com");
  });

  it("throws only when there is nothing at all to go on", () => {
    expect(() => stagingDatabaseURL()).toThrow(/Cannot determine the staging database URL/);
  });
});

/**
 * @jest-environment node
 *
 * createExperimentHandler logs a failed createDataContainer to Cloud Logging.
 * Auth rides in request headers, but a provider can still echo the token in
 * its error text (a Dataverse installation answering "Bad api key <key>"), so
 * the logged stack must be scrubbed. The 502 detail still goes back to the
 * researcher unchanged: it is their own token, on their own request.
 */

const TOKEN = "dv-secret-token-1234";

jest.mock("../../lib/app.js", () => ({
  db: { doc: () => ({ get: async () => ({ data: () => ({}) }) }) },
}));
jest.mock("../../lib/connect-provider.js", () => ({
  verifyOwnership: async () => ({ ok: true }),
}));
jest.mock("../../lib/resolve-token.js", () => ({
  __esModule: true,
  default: async () => ({ success: true, token: TOKEN, serverUrl: "https://dataverse.mock.test" }),
}));
jest.mock("../../lib/providers/index.js", () => ({
  listProviders: () => ["dataverse"],
  getProvider: () => ({
    containerInput: [],
    createDataContainer: async () => {
      throw new Error(`Dataverse dataset creation failed: 401 Bad api key ${TOKEN}`);
    },
  }),
}));

const { createExperimentHandler } = require("../../lib/create-experiment.js");

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

it("scrubs the provider token from the logged error", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  const res = mockRes();

  await createExperimentHandler(
    { method: "POST", body: { provider: "dataverse", title: "t", uid: "u1", idToken: "x" } },
    res
  );

  expect(res.status).toHaveBeenCalledWith(502);
  expect(error).toHaveBeenCalledTimes(1);
  const logged = JSON.stringify(error.mock.calls[0]);
  expect(logged).not.toContain(TOKEN);
  expect(logged).toContain("Bad api key [redacted]");
  expect(logged).toContain("create-experiment"); // the stack survives
  error.mockRestore();
});

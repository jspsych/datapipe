// The three one-shot REST calls: saveData, saveBase64Data, getCondition.
// Incremental upload (DataPipeSession) lives in session.ts and calls
// saveData too, via the caller's own code -- see the `sessionId` option.

import { endpoint, experimentIDFrom, isSuccessfulResult, sendRequest } from "./http.js";
import { ExperimentIDOption, SaveResult } from "./types.js";

export { setBaseURL, getBaseURL } from "./http.js";

async function postJSON(
  url: string,
  payload: Record<string, unknown>,
  compress: boolean
): Promise<SaveResult> {
  try {
    const response = await sendRequest(url, payload, compress);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // A non-JSON response body. Treated as a failure below by
      // isSuccessfulResult(null), same as any other malformed answer.
      body = null;
    }
    return { ok: isSuccessfulResult(body), status: response.status, body };
  } catch (error) {
    // The request never reached the server (offline, DNS failure, CORS,
    // etc.). status: 0 signals that distinctly from any real HTTP status.
    return { ok: false, status: 0, body: error };
  }
}

/**
 * Save data to a researcher's storage provider via pipe.jspsych.org (or
 * another deployment).
 *
 * @param options.experiment_id The 12-character experiment ID. (`experimentID`
 *   is accepted too; see `ExperimentIDOption`.)
 * @param options.filename A unique filename to save the data to, including
 *   its extension. If it already exists, no data will be saved.
 * @param options.data A string-based representation of the data (JSON, CSV,
 *   or any other text-based format).
 * @param options.sessionId Present only for a streamed session -- see
 *   `DataPipeSession`. Carries no data of its own; it tells DataPipe which
 *   staged copy this submission supersedes.
 * @param options.baseURL Override the DataPipe deployment for this call.
 */
export async function saveData(
  options: ExperimentIDOption & {
    filename: string;
    data: string;
    sessionId?: string;
    baseURL?: string;
  }
): Promise<SaveResult> {
  const experimentID = experimentIDFrom(options);
  const { filename, data, sessionId, baseURL } = options;
  if (!experimentID || !filename || !data) {
    throw new Error("Missing required parameter(s).");
  }
  return postJSON(
    endpoint("data", baseURL),
    {
      experimentID,
      filename,
      data,
      ...(sessionId ? { sessionId } : {}),
    },
    true
  );
}

/**
 * Save base64-encoded data (e.g. audio, images) to a researcher's storage
 * provider. The server decodes it to binary before storing it.
 *
 * @param options.experiment_id The 12-character experiment ID. (`experimentID`
 *   is accepted too; see `ExperimentIDOption`.)
 * @param options.filename A unique filename to save the data to, including
 *   its extension.
 * @param options.data The data as a base64-encoded string.
 * @param options.baseURL Override the DataPipe deployment for this call.
 */
export async function saveBase64Data(
  options: ExperimentIDOption & {
    filename: string;
    data: string;
    baseURL?: string;
  }
): Promise<SaveResult> {
  const experimentID = experimentIDFrom(options);
  const { filename, data, baseURL } = options;
  if (!experimentID || !filename || !data) {
    throw new Error("Missing required parameter(s).");
  }
  return postJSON(
    endpoint("base64", baseURL),
    { experimentID, filename, data },
    true
  );
}

/**
 * Get the condition assignment for the current participant.
 *
 * THROWS ON FAILURE, unlike the rest of this library.
 *
 * Everything to do with staging fails quietly on purpose: a trial that cannot
 * be staged is still submitted at the end, so the participant should never see
 * anything go wrong. A condition is the opposite. It usually decides which
 * timeline a participant runs, so a quiet fallback value would send them
 * through the wrong experiment -- or through an empty one -- and the researcher
 * would find out from the data weeks later, if at all.
 *
 * So the caller has to decide what happens, which means the caller has to be
 * told:
 *
 * ```js
 * let condition;
 * try {
 *   condition = await getCondition({ experiment_id: "abc123" });
 * } catch (error) {
 *   document.body.innerHTML = "<p>The experiment could not be started.</p>";
 *   throw error;
 * }
 * ```
 *
 * @param options.experiment_id The 12-character experiment ID. (`experimentID`
 *   is accepted too; see `ExperimentIDOption`.)
 * @param options.baseURL Override the DataPipe deployment for this call.
 * @throws If the request cannot be made, DataPipe refuses it (condition
 *   assignment switched off, experiment closed), or the response carries no
 *   condition.
 */
export async function getCondition(
  options: ExperimentIDOption & { baseURL?: string }
): Promise<number> {
  const experimentID = experimentIDFrom(options);
  const { baseURL } = options;
  if (!experimentID) {
    throw new Error("datapipe: getCondition requires an experiment_id.");
  }

  let response: Response;
  try {
    response = await fetch(endpoint("condition", baseURL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      body: JSON.stringify({ experimentID }),
    });
  } catch (error) {
    // Offline, DNS failure, CORS -- the request never reached DataPipe.
    throw new Error("datapipe: could not reach DataPipe to request a condition.", {
      cause: error,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(
      `datapipe: DataPipe's condition response could not be read (HTTP ${response.status}).`,
      { cause: error }
    );
  }

  if (!isSuccessfulResult(body)) {
    const reason = (body as { error?: unknown } | null)?.error;
    throw new Error(
      `datapipe: DataPipe refused the condition request (HTTP ${response.status})` +
        (reason ? `: ${reason}` : ".")
    );
  }

  const condition = (body as { condition?: unknown }).condition;
  if (typeof condition !== "number") {
    throw new Error("datapipe: DataPipe's response did not contain a condition assignment.");
  }
  return condition;
}

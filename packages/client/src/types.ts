// Public types for datapipe-client. See src/index.ts for the exported
// surface these describe, and docs/streaming-ingest-design.md (in the
// DataPipe repository) for the staging-tier design these types are part of.

/** Options for starting an incremental-upload session. */
export interface SessionOptions {
  /** The 12-character experiment ID provided by pipe.jspsych.org. */
  experimentID: string;
  /**
   * The filename this participant will submit under, if it is already known.
   *
   * Used only to NAME a recovered partial session, so an abandoned run
   * appears in the researcher's storage as `subject42.partial.json` rather
   * than an opaque id. Never used for a completed submission -- that carries
   * its own filename on `saveData`, as always.
   */
  filename?: string;
  /** Override the DataPipe deployment. Defaults to https://pipe.jspsych.org. */
  baseURL?: string;
}

/** The outcome of a `saveData` / `saveBase64Data` call. */
export interface SaveResult {
  /**
   * Whether the request succeeded.
   *
   * A number is a success (including a condition of 0); a 202 (queued for
   * retry) counts, because DataPipe holds that copy durably; a network
   * failure is NOT a success. See `isSuccessfulResult` in ./http.ts for the
   * full rationale -- this field IS that check, so every caller gets it for
   * free instead of having to reimplement it (and possibly get it wrong, the
   * way the ported plugin code once did).
   */
  ok: boolean;
  /** The HTTP status code, or 0 when the request never reached the server. */
  status: number;
  /**
   * The parsed JSON response body on a completed request, or the thrown
   * error (e.g. a network failure) when the request never got a response.
   */
  body: any;
}

/**
 * What `POST /api/session` answers with
 * (functions/src/api-session-start.ts in the DataPipe repository).
 *
 * Nothing about the staging tier's limits is compiled into this library --
 * they all come from this response, so the client can never drift from the
 * server-side rules that actually enforce them.
 */
export interface SessionConfig {
  sessionId: string;
  databaseURL: string;
  maxTrialBytes: number;
  maxTrials: number;
  flushIntervalMs: number;
  flushEveryNTrials: number;
  /**
   * How many per-connection disconnect slots the rules allow. Absent from an
   * older or unrecognized server response; DataPipeSession treats that
   * conservatively (never re-arming past the first slot) rather than
   * assuming a number that could silently drift from the rules -- see
   * `armDisconnect` in session.ts.
   */
  maxDisconnects?: number;
}

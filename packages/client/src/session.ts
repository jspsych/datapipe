// Incremental session upload: make each trial durable as it is produced, so
// a participant who closes the tab at trial 199 of 200 does not lose all
// 199.
//
// See docs/streaming-ingest-design.md in the DataPipe repository for the
// design. The short version of the contract this file implements:
//
//   1. POST /api/session. DataPipe checks the experiment is open and mints
//      an unguessable session id, and tells us which Realtime Database to
//      stage into. Nothing about the staging tier's limits is compiled into
//      this library -- they all come from that response.
//   2. Write each trial to that database DIRECTLY, with no function
//      invocation. This is the whole point: a per-trial POST would be a
//      per-trial function call and a per-trial write to the researcher's
//      storage provider, which is the condition DataPipe's archive
//      compaction exists to undo.
//   3. Register onDisconnect() so FIREBASE'S SERVERS mark the session
//      abandoned when the socket drops -- "whether the client disconnects
//      cleanly or not", including a closed laptop or dead wifi. No
//      heartbeat, no timer, no polling.
//   4. On clean completion, cancel that onDisconnect and submit normally
//      (via saveData). The final submission still carries the whole
//      dataset, because the caller still has it; staging exists for the
//      sessions that never reach step 4.
//
// FAILURE IS ALWAYS SILENT AND NON-FATAL. Every entry point here is written
// so that a participant whose staging fails -- offline, blocked host,
// DataPipe down, no RTDB provisioned -- still runs the experiment to the end
// and still submits at the end, exactly as they would have without this
// file. Streaming is a safety net. A safety net that can break the thing it
// is protecting is worse than no net.

import { FirebaseApp, deleteApp, initializeApp } from "firebase/app";
import {
  Database,
  Unsubscribe,
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
  update,
} from "firebase/database";

import { endpoint, experimentIDFrom } from "./http.js";
import { SessionConfig, SessionOptions } from "./types.js";

// How many trials record() will hold onto before the session has finished
// starting (see the "pre-start buffering" section below). Generous for any
// realistic burst of trials that finishes before a round trip to
// /api/session does, and bounded so a caller that never starts a session (a
// permanently offline participant, say) cannot have this grow without
// limit.
const MAX_PENDING_TRIALS = 500;

/**
 * A staging session, in incremental-upload terms.
 *
 * Instances are produced by `createSession()` or `startSession()` and are
 * always usable, even when nothing could be started -- see `enabled`. That
 * is what lets callers write `on_data_update: (d) => session.record(d)`
 * without a guard, and lets a failed (or not-yet-started) session degrade to
 * ordinary end-of-experiment submission instead of throwing.
 */
export class DataPipeSession {
  private _enabled = false;
  /**
   * False when this session is inert: the start call has not finished (yet,
   * or ever), failed, the browser has no usable connection, the session was
   * closed, or the trial ceiling was reached. `record`, `flush` and `close`
   * are never unsafe to call regardless of this value.
   */
  get enabled(): boolean {
    return this._enabled;
  }

  private _sessionId = "";
  /**
   * The id to send with the final submission. Empty until the session has
   * started (see `ready()`), and for good if it never does.
   */
  get sessionId(): string {
    return this._sessionId;
  }

  private config: SessionConfig | null = null;
  private app: FirebaseApp | null = null;
  private db: Database | null = null;

  // Buffered, ADMITTED trials, flushed together. Batching is the difference
  // between one write per trial and one write per handful, and it is worth
  // doing on its own: the design doc notes that batching alone may satisfy
  // "recover if it disconnects" for many studies.
  private buffer: string[] = [];
  // Monotonic and NEVER reset. The staging tier is append-only, so a retried
  // flush that renumbered would collide with trials already written and be
  // refused. Advancing past a failed flush leaves a gap, which the server
  // deliberately tolerates.
  private nextSeq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> = Promise.resolve();

  private connectionUnsub: Unsubscribe | null = null;
  private onVisibilityChange: (() => void) | null = null;
  private hasConnectedBefore = false;
  // The disconnect slot armed for the CURRENT connection, 1-based; 0 before
  // the first arm. Every connection gets its own write-once slot pair, so a
  // stamp from an old connection that lands late (a half-open socket after a
  // network switch) can never be mistaken for the current one dropping.
  private armedSlot = 0;

  // --- Pre-start buffering -------------------------------------------------
  //
  // record() can now be called before the /api/session round trip resolves
  // -- in particular via createSession(), which returns a session
  // synchronously and starts that round trip in the background (see the
  // module-level createSession() below for why: some callers, e.g. a jsPsych
  // extension, cannot await before the first trial might run). Trials
  // recorded in that window are held here, NOT in `buffer` -- they have not
  // been checked against the server's admission rules yet, because those
  // rules (maxTrialBytes, maxTrials) are themselves part of the /api/session
  // response. Once start() settles, every pending trial is run through the
  // same admission checks record() applies normally, then flushed.
  private phase: "pending" | "ready" | "failed" = "pending";
  private pending: string[] = [];
  private pendingLimitWarned = false;
  // Set as soon as close() is called, even while still pending, so a trial
  // recorded after the caller has already asked to close does not get
  // staged just because the round trip to /api/session is still in flight.
  private closeRequested = false;
  // Cached so start() is idempotent: createSession() calls it once and
  // startSession() awaits the same call rather than starting a second
  // request.
  private startPromise: Promise<void> | null = null;

  /**
   * @internal Use `createSession()` or `startSession()`, not this directly.
   */
  start(
    experimentID: string,
    endpointURL: string,
    options: { filename?: string } = {}
  ): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.doStart(experimentID, endpointURL, options);
    }
    return this.startPromise;
  }

  /**
   * Resolves once the session has started, or failed to start. Never
   * rejects. From then on `sessionId` is final: the session's id, or "" if
   * it could not start.
   *
   * This waits only for the round trip to /api/session, not for any staged
   * writes, so it is the thing to await before submitting. (`saveData` does
   * it for you when given `session`.)
   */
  async ready(): Promise<void> {
    await this.startPromise;
  }

  private async doStart(
    experimentID: string,
    endpointURL: string,
    options: { filename?: string }
  ): Promise<void> {
    if (!experimentID) {
      this.warn("startSession requires an experiment id; streaming is disabled.");
      this.failStart();
      return;
    }

    try {
      const response = await fetch(endpointURL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "*/*" },
        body: JSON.stringify({ experimentID, filename: options.filename }),
      });
      if (!response.ok) {
        // A 400 means the experiment is closed, finalized or full, and a
        // 503 means the deployment has no staging tier. Both are answered
        // again, identically, by the final submission -- so say nothing
        // alarming here and let that be where the participant learns about
        // it.
        this.warn(`session not started (HTTP ${response.status}); data will be sent at the end`);
        this.failStart();
        return;
      }
      const config = (await response.json()) as SessionConfig;
      if (!config?.sessionId || !config?.databaseURL) {
        this.warn("session response was incomplete; data will be sent at the end");
        this.failStart();
        return;
      }

      this.config = config;
      // A NAMED app. The researcher's own page may already have initialized
      // Firebase for something else, and taking the default app slot would
      // break it.
      this.app = initializeApp({ databaseURL: config.databaseURL }, `datapipe-${config.sessionId}`);
      this.db = getDatabase(this.app);
      this._enabled = true;
      this._sessionId = config.sessionId;
      this.phase = "ready";

      this.armDisconnect();
      this.watchConnection();
      this.watchVisibility();

      this.drainPending();
    } catch (error) {
      this.warn("could not start a session; data will be sent at the end", error);
      this.failStart();
    }
  }

  private failStart(): void {
    this.phase = "failed";
    this._enabled = false;
    this.pending = [];
  }

  /**
   * Run every trial buffered before start() settled through the normal
   * admission checks, then flush whatever was admitted. Called only once,
   * right after a successful start.
   */
  private drainPending(): void {
    const pending = this.pending;
    this.pending = [];
    if (pending.length === 0) return;
    for (const serialized of pending) {
      if (!this._enabled) break; // the trial ceiling was hit partway through
      this.admitSerialized(serialized);
    }
    void this.flush();
  }

  private bufferPending(trialData: unknown): void {
    let serialized: string;
    try {
      serialized = JSON.stringify(trialData);
    } catch (error) {
      // A circular reference, or a value JSON cannot represent. Still in the
      // caller's own data and will be submitted at the end regardless.
      this.warn("a trial could not be serialized and was not staged", error);
      return;
    }

    if (this.pending.length >= MAX_PENDING_TRIALS) {
      if (!this.pendingLimitWarned) {
        this.pendingLimitWarned = true;
        this.warn(
          `more than ${MAX_PENDING_TRIALS} trials were recorded before the session finished ` +
            "starting; no further trials will be held for it. They are still in the caller's " +
            "own data and will be sent at the end."
        );
      }
      return;
    }

    this.pending.push(serialized);
  }

  /**
   * Admit one already-serialized trial into the flush buffer, applying the
   * same size and trial-count checks as an ordinary record() call. Shared by
   * record() (fresh trials) and drainPending() (trials buffered before
   * start finished), so the two can never disagree about what is allowed.
   */
  private admitSerialized(serialized: string): boolean {
    if (!this.config) return false;

    // String length, not byte length, because that is what the server's
    // security rule measures.
    if (serialized.length > this.config.maxTrialBytes) {
      this.warn(
        `a trial of ${serialized.length} characters exceeds the ${this.config.maxTrialBytes} ` +
          "character staging limit and was not staged; it will still be sent at the end"
      );
      // The sequence number is deliberately NOT consumed: nothing was
      // written, and skipping one would report a false gap on recovery.
      return false;
    }

    if (this.nextSeq + this.buffer.length >= this.config.maxTrials) {
      this.warn(
        `the ${this.config.maxTrials}-trial staging limit was reached; no further trials will be staged`
      );
      this._enabled = false;
      return false;
    }

    this.buffer.push(serialized);
    return true;
  }

  /**
   * Buffer one trial's data. Safe to call unconditionally, whether or not
   * the session ever started, and whether or not it has started YET --
   * trials recorded before start() settles are held (see "Pre-start
   * buffering" above) rather than dropped.
   */
  record(trialData: unknown): void {
    if (this.closeRequested) return; // closing, or already closed

    if (this.phase === "pending") {
      this.bufferPending(trialData);
      return;
    }
    if (!this._enabled || !this.config) return;

    let serialized: string;
    try {
      serialized = JSON.stringify(trialData);
    } catch (error) {
      this.warn("a trial could not be serialized and was not staged", error);
      return;
    }

    if (!this.admitSerialized(serialized)) return;

    if (this.buffer.length >= this.config.flushEveryNTrials) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /**
   * Write everything buffered. Resolves when the write settles, or
   * immediately when there is nothing to write.
   *
   * Flushes are CHAINED rather than run concurrently, so two overlapping
   * flushes cannot interleave their sequence numbers.
   *
   * Safe to call before start() has settled: it waits for that first, so a
   * flush requested early still lands once (if) the session comes up,
   * instead of silently being a no-op.
   */
  async flush(): Promise<void> {
    if (this.phase === "pending" && this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }

    this.cancelTimer();
    if (!this._enabled || !this.db || !this.config || this.buffer.length === 0) {
      return this.flushing;
    }

    const batch = this.buffer;
    this.buffer = [];
    const startSeq = this.nextSeq;
    this.nextSeq += batch.length;

    this.flushing = this.flushing.then(async () => {
      const updates: Record<string, unknown> = {};
      batch.forEach((trial, i) => {
        updates[`trials/${startSeq + i}`] = trial;
      });
      // Stamped in the same write, so it costs nothing extra. It is the
      // server's backstop liveness signal for a client that dies before
      // onDisconnect can fire.
      updates["meta/lastFlushAt"] = serverTimestamp();
      try {
        await update(ref(this.db!, `staging/${this.config!.sessionId}`), updates);
      } catch (error) {
        // The trials stay in the caller's own data and are submitted at the
        // end. The sequence numbers are NOT reused -- re-flushing them would
        // be refused by the append-only rule anyway, and the server
        // tolerates the gap.
        this.warn("a batch of trials could not be staged", error);
      }
    });

    return this.flushing;
  }

  /**
   * End the session: flush the tail, settle the abandonment stamp, and close
   * the connection.
   *
   * Safe to call before start() has settled -- see `flush()` -- so a very
   * short experiment that closes immediately does not leak a connection
   * that was still being opened, or leave an onDisconnect armed with no way
   * to cancel it.
   *
   * WHAT HAPPENS TO THE STAMP DEPENDS ON WHETHER THE DATA ARRIVED, which is
   * why this takes the outcome and why callers should call it AFTER
   * submitting via saveData, not before.
   *
   *  - `submitted: true` (the default) cancels the onDisconnect, so a
   *    completed session is never also reported as abandoned when the page
   *    finally closes. DataPipe deletes the staging node on success too,
   *    which makes a surviving stamp unwritable -- but that delete is
   *    best-effort, and a stamp outliving it would produce a duplicate
   *    .partial.json.
   *  - `submitted: false` stamps the session abandoned NOW. The final
   *    submission failed and the caller is not going to send anything else.
   *    Stamping immediately gets the session recovered on the sweep's normal
   *    schedule instead of waiting for the 24-hour expiry.
   */
  async close(options: { submitted?: boolean } = {}): Promise<void> {
    this.closeRequested = true;
    if (this.phase === "pending" && this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }

    if (!this._enabled) return;
    const submitted = options.submitted ?? true;
    await this.flush().catch(() => undefined);

    try {
      if (this.db && this.config) {
        const slot = this.slotRef("disconnects", this.armedSlot || 1);
        if (submitted) {
          await onDisconnect(slot).cancel();
        } else {
          // The current connection's own slot, written now instead of when
          // the socket eventually closes. The armed onDisconnect for the
          // same slot is then refused as a second write, which is harmless.
          await set(slot, serverTimestamp());
        }
      }
    } catch {
      // Nothing more to do. If the stamp could not be written, the armed
      // onDisconnect writes it anyway when teardown closes the socket
      // below, and the 24-hour expiry is the backstop behind that.
    }

    this.teardown();
  }

  /**
   * Ask Firebase's servers to stamp this connection's slot if it drops.
   * Re-armed, on the NEXT slot, after every reconnect -- an onDisconnect is
   * consumed when it fires, so a session that survives a dropout would
   * otherwise be left with no abandonment stamp at all.
   *
   * Stops at the rules' slot cap, taken from `maxDisconnects` in the
   * /api/session response. If the server did not send one (an older or
   * unrecognized deployment), this arms only the FIRST connection's slot and
   * never re-arms -- conservative, rather than assuming a cap that could
   * drift from the rules that actually enforce it. Past the cap, a further
   * dropout is still recovered, by the server's 24-hour expiry instead of
   * the faster sweep path.
   */
  private async armDisconnect(): Promise<void> {
    if (!this.db || !this.config) return;
    const max = this.config.maxDisconnects;

    if (max === undefined) {
      if (this.armedSlot >= 1) return;
    } else if (this.armedSlot >= max) {
      this.warn(
        `this session has disconnected ${max} times; further dropouts will be recovered, but more slowly`
      );
      return;
    }

    this.armedSlot += 1;
    try {
      await onDisconnect(this.slotRef("disconnects", this.armedSlot)).set(serverTimestamp());
    } catch (error) {
      // Staging still works; only automatic recovery is lost, and the
      // session is still swept once its server-side expiry passes.
      this.warn("could not arm disconnect detection", error);
    }
  }

  private slotRef(kind: "disconnects" | "reconnects", slot: number) {
    return ref(this.db!, `staging/${this.config!.sessionId}/meta/${kind}/${slot}`);
  }

  /**
   * Answer the dropped connection's slot and arm the next one, on every
   * reconnect after the first.
   *
   * THIS IS NOT OPTIONAL. onDisconnect fires on any socket drop -- hotel
   * wifi, a closed laptop lid, a phone moving from wifi to cellular. Without
   * this, a single blip permanently marks a running session abandoned, and
   * DataPipe's sweep writes a partial file for a participant who is still
   * doing trials.
   */
  private watchConnection(): void {
    if (!this.db || !this.config) return;
    this.connectionUnsub = onValue(ref(this.db, ".info/connected"), (snapshot) => {
      if (snapshot.val() !== true) return;
      if (!this.hasConnectedBefore) {
        this.hasConnectedBefore = true;
        return;
      }
      void (async () => {
        const dropped = this.armedSlot;
        if (dropped > 0) {
          try {
            // Written whether or not that slot's stamp has landed yet: a
            // half-open old socket may deliver it AFTER this. The mark
            // answers the slot either way, which is the point of keying by
            // connection.
            await set(this.slotRef("reconnects", dropped), serverTimestamp());
          } catch (error) {
            // Already written, or refused. Either way DataPipe also treats
            // trials arriving after a stamp as proof the participant is
            // back.
            this.warn("could not record the reconnect", error);
          }
        }
        await this.armDisconnect();
      })();
    });
  }

  /**
   * Flush the tail when the page is being hidden.
   *
   * `visibilitychange` to hidden is the last event a mobile browser reliably
   * delivers before it may freeze or discard the page -- `beforeunload` and
   * `unload` are not fired at all in several of those cases. No sendBeacon
   * is needed here: the socket already has the write queued, and if the
   * page dies anyway the onDisconnect above is exactly the mechanism that
   * covers it.
   */
  private watchVisibility(): void {
    if (typeof document === "undefined") return;
    this.onVisibilityChange = () => {
      if (document.visibilityState === "hidden") void this.flush();
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  private scheduleFlush(): void {
    if (this.timer || !this.config) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.config.flushIntervalMs);
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private teardown(): void {
    this._enabled = false;
    this.cancelTimer();
    if (this.connectionUnsub) {
      this.connectionUnsub();
      this.connectionUnsub = null;
    }
    if (this.onVisibilityChange && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.onVisibilityChange = null;
    }
    // Closes the websocket. Without it the caller's page holds an open
    // connection for as long as the page is up, including through a
    // debrief screen that has nothing left to send.
    if (this.app) {
      void deleteApp(this.app).catch(() => undefined);
      this.app = null;
    }
    this.db = null;
  }

  private warn(message: string, error?: unknown): void {
    if (error === undefined) console.warn(`datapipe: ${message}`);
    else console.warn(`datapipe: ${message}`, error);
  }
}

/**
 * The experiment ID for a session, or "" if there is no usable one.
 *
 * `experimentIDFrom` throws when `experiment_id` and `experimentID`
 * disagree, which is right for `saveData` but not here: starting a session
 * never throws (see `startSession`). An empty ID turns streaming off in
 * `doStart`, and a `saveData` call given the same options throws where
 * the caller can see it.
 */
function sessionExperimentID(options: SessionOptions): string {
  try {
    return experimentIDFrom(options);
  } catch (error) {
    console.warn((error as Error).message);
    return "";
  }
}

/**
 * Start an incremental upload session SYNCHRONOUSLY: the session object is
 * returned immediately, and the POST /api/session round trip runs in the
 * background.
 *
 * Prefer `startSession()` when the caller can await -- it is simpler to
 * reason about, because by the time it resolves the session's `enabled` and
 * `sessionId` already reflect the outcome. `createSession()` exists for
 * callers that CANNOT await before the first trial might run (for example a
 * jsPsych extension's `initialize()`, whose returned promise is dropped by
 * `ExtensionManager.initializeExtensions()` -- so anything after the first
 * `await` can race the first trial). Calling `record()` on the object this
 * returns is always safe, before or after the round trip settles: trials
 * recorded early are held (see "Pre-start buffering" in DataPipeSession) and
 * staged once (if) the session comes up. `flush()` and `close()` are safe
 * too -- both wait for the round trip to settle before doing anything, so a
 * very short run that closes immediately still cancels the onDisconnect
 * rather than leaking a connection that was still being opened.
 */
export function createSession(options: SessionOptions): DataPipeSession {
  const session = new DataPipeSession();
  // Fire-and-forget: errors are handled inside start() itself (see
  // doStart's catch block) and never surface here or reject anything.
  void session.start(sessionExperimentID(options), endpoint("session", options.baseURL), {
    filename: options.filename,
  });
  return session;
}

/**
 * Start an incremental upload session, so trials become durable as they are
 * produced rather than only at the end.
 *
 * ALWAYS RESOLVES, and never rejects. If a session cannot be started -- the
 * experiment is closed, the caller is offline, the deployment has no
 * staging tier -- the returned session is inert and every method on it is a
 * no-op (record() simply does nothing once the failure is known; see
 * `createSession()` for what happens to trials recorded in the meantime).
 * The experiment then behaves exactly as it would without streaming:
 * everything is submitted once, at the end via `saveData`. That is a
 * deliberate contract: this feature is a safety net, and a safety net must
 * not be able to break the thing it is protecting.
 */
export async function startSession(options: SessionOptions): Promise<DataPipeSession> {
  const session = new DataPipeSession();
  await session.start(sessionExperimentID(options), endpoint("session", options.baseURL), {
    filename: options.filename,
  });
  return session;
}

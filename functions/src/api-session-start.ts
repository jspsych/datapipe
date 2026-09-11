// POST /api/session -- admit a participant to the RTDB staging tier
// (docs/streaming-ingest-design.md).
//
// WHAT THIS ENDPOINT IS FOR
//
// RTDB security rules cannot read Firestore. They cannot see `active`,
// `finalized`, or `limitSessions`/`maxSessions` -- the four gates api-data.ts
// checks before accepting anything -- which is the central problem the design
// doc identified for a client-written staging tier.
//
// The doc's answer was to mirror those flags into RTDB as
// `openExperiments/{experimentId}`. This endpoint is the answer that replaced
// it: run the gates HERE, in a function, against Firestore, where they already
// work and are already covered by data-emulator.test.js -- then put a single
// unguessable session id into RTDB and let the rules gate on nothing more than
// its existence.
//
// What that buys, beyond deleting the mirror and its reconciliation pass:
//
//   - A session id CANNOT BE FORGED. The design doc's staging tier was
//     writable by anyone holding an experiment id, which is public by
//     construction -- it sits in the experiment's own JavaScript. Here, an id
//     that no function minted is worth nothing.
//   - A closed experiment stops accepting staged data immediately, with no
//     mirror to drift and no half-failed toggle to leave it permanently open.
//
// THE COST, STATED
//
// A completed session now costs TWO function invocations instead of one. At
// the design doc's measured ~10,000 sessions/month that is 20,000 invocations
// against a 2,000,000/month free tier, and it stays inside that tier at 100x
// current volume. The invocation the design was actually built to avoid -- one
// per TRIAL -- is still avoided entirely: nothing between this call and the
// completion call touches a function.
//
// WHAT THIS ENDPOINT DOES NOT DO
//
// It does not increment `sessions`. Counting a session at admission would
// count abandoned participants against a researcher's maxSessions cap, and
// would double-count against the completion path that already does it. The cap
// is therefore checked here but consumed only at completion, exactly as today
// -- so a session admitted just under the cap and completed just over it is
// accepted, which is the same behaviour two concurrent submissions have always
// had.

import { onRequest } from "firebase-functions/v2/https";
import { DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import { ExperimentData } from "./interfaces.js";
import {
  openSession,
  stagingDatabaseURL,
  MAX_TRIAL_BYTES,
  MAX_TRIALS_PER_SESSION,
  FLUSH_INTERVAL_MS,
  FLUSH_EVERY_N_TRIALS,
  MAX_DISCONNECTS,
} from "./staging.js";

export const apiSessionStart = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // `filename` is optional and advisory: it is used ONLY to name a recovered
  // partial session, so that an abandoned run lands in the researcher's
  // storage under a name they recognise instead of an opaque session id. A
  // clean completion carries its own filename on the /api/data request, as it
  // always has, and never consults this. Sanitised in partialFilenameFor().
  const { experimentID, filename }: { experimentID?: string; filename?: string } =
    req.body ?? {};

  if (!experimentID) {
    res.status(400).json(MESSAGES.MISSING_PARAMETER);
    return;
  }

  const exp_doc: DocumentSnapshot = await db
    .collection("experiments")
    .doc(experimentID)
    .get();

  if (!exp_doc.exists) {
    res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
    await writeLog(experimentID, "logError", MESSAGES.EXPERIMENT_NOT_FOUND);
    return;
  }

  const exp_data: ExperimentData = exp_doc.data() as ExperimentData;

  if (!exp_data) {
    res.status(400).json(MESSAGES.EXPERIMENT_DATA_NOT_FOUND);
    await writeLog(experimentID, "logError", MESSAGES.EXPERIMENT_DATA_NOT_FOUND);
    return;
  }

  const logContext = {
    owner: exp_data.owner,
    storageProvider: exp_data.storageProvider,
  };

  // Counted after the experiment is known to exist, for the reason
  // write-log.ts gives: counting first meant every request carrying a mistyped
  // or invented experiment ID created a log document with no owner, which
  // nobody can read and nothing bounds.
  await writeLog(experimentID, "startSession", undefined, logContext);

  // The same four gates as api-data.ts, in the same order and with the same
  // codes, so a participant whose session is refused here gets the identical
  // answer they would have got submitting at the end. `finalized` is checked
  // ahead of `active` for the reason documented there: finalizing does not
  // require a researcher to also switch collection off, and EXPERIMENT_FINALIZED
  // is the message that should surface either way.
  if (exp_data.finalized) {
    res.status(400).json(MESSAGES.EXPERIMENT_FINALIZED);
    await writeLog(experimentID, "logError", MESSAGES.EXPERIMENT_FINALIZED, logContext);
    return;
  }

  if (!exp_data.active) {
    res.status(400).json(MESSAGES.DATA_COLLECTION_NOT_ACTIVE);
    await writeLog(experimentID, "logError", MESSAGES.DATA_COLLECTION_NOT_ACTIVE, logContext);
    return;
  }

  if (exp_data.limitSessions && exp_data.sessions >= exp_data.maxSessions) {
    res.status(400).json(MESSAGES.SESSION_LIMIT_REACHED);
    await writeLog(experimentID, "logError", MESSAGES.SESSION_LIMIT_REACHED, logContext);
    return;
  }

  let sessionId: string;
  let databaseURL: string;
  try {
    databaseURL = stagingDatabaseURL();
    sessionId = await openSession(experimentID, filename, exp_data.owner);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    // A 503, not a 500, and the message says the experiment can still submit
    // at the end. This is the failure mode of a deployment whose RTDB instance
    // has not been provisioned yet, and it must degrade to today's behaviour
    // rather than looking to the plugin like a broken experiment.
    res.status(503).json({ ...MESSAGES.SESSION_START_ERROR, detail });
    await writeLog(
      experimentID,
      "logError",
      { ...MESSAGES.SESSION_START_ERROR, detail },
      logContext
    );
    return;
  }

  // Everything the plugin needs to run the staging tier, so that nothing about
  // it is compiled into the published bundle:
  //
  //   databaseURL       -- which deployment to stage into. This is what lets
  //                        ONE plugin release talk to both datapipe-test and
  //                        production without a build flag on the
  //                        participant's side.
  //   maxTrialBytes     -- the cap database.rules.json enforces. Sent rather
  //                        than duplicated in the plugin, so the number the
  //                        client checks against can never drift from the rule
  //                        that actually rejects the write.
  //   flush cadence     -- tunable from the server, without a coordinated
  //                        plugin release.
  //   maxDisconnects    -- the rules' cap on abandonment stamps, for the same
  //                        reason as maxTrialBytes.
  res.status(200).json({
    sessionId,
    databaseURL,
    maxTrialBytes: MAX_TRIAL_BYTES,
    maxTrials: MAX_TRIALS_PER_SESSION,
    flushIntervalMs: FLUSH_INTERVAL_MS,
    flushEveryNTrials: FLUSH_EVERY_N_TRIALS,
    // The rules' cap on abandonment stamps. The plugin stops re-arming its
    // onDisconnect when it reaches this, rather than having stamps refused.
    maxDisconnects: MAX_DISCONNECTS,
  });
});

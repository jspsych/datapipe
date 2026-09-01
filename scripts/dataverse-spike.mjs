// Dataverse gating spike (docs/provider-migration-design.md, build step 6).
//
// Runs the three go/no-go gates against a LIVE Dataverse installation, using
// the real shipping adapter (functions/lib/providers/dataverse.js) rather than
// a hand-written approximation -- so this validates our multipart body,
// response parsing and error mapping at the same time as it validates the
// service.
//
// Usage:
//   cd functions && npm run build && cd ..
//   DATAVERSE_TOKEN=xxxx DATAVERSE_COLLECTION=my-alias node scripts/dataverse-spike.mjs
//
// Env:
//   DATAVERSE_TOKEN      (required) API token from your account's API Token tab
//   DATAVERSE_COLLECTION (required) alias of a collection you can create datasets in
//   DATAVERSE_SERVER     (default https://demo.dataverse.org)
//   DATAVERSE_BURST      (default 40) files written concurrently for gate A
//   DATAVERSE_CLEANUP    (set to 1 to delete the test dataset when done)
//
// Leaves the dataset in DRAFT and never publishes. Nothing here mints a DOI
// that outlives the run beyond the draft itself.

import { dataverseProvider } from "../functions/lib/providers/dataverse.js";

const token = process.env.DATAVERSE_TOKEN;
const collectionAlias = process.env.DATAVERSE_COLLECTION;
const serverUrl = process.env.DATAVERSE_SERVER || "https://demo.dataverse.org";
const burst = Number(process.env.DATAVERSE_BURST || 40);

if (!token || !collectionAlias) {
  console.error("DATAVERSE_TOKEN and DATAVERSE_COLLECTION are required. See the header of this file.");
  process.exit(1);
}

const auth = { token, serverUrl };
const results = [];
const record = (gate, verdict, detail) => {
  results.push({ gate, verdict, detail });
  const mark = verdict === "PASS" ? "PASS" : verdict === "FAIL" ? "FAIL" : "INFO";
  console.log(`\n[${mark}] ${gate}\n      ${detail}`);
};

const meta = (body, contentType) => ({ size: Buffer.byteLength(body), contentType });

async function main() {
  console.log(`Dataverse spike against ${serverUrl}`);
  console.log(`Collection: ${collectionAlias}   Burst size: ${burst}\n`);

  // ---- sanity: does the token work at all -------------------------------
  const valid = await dataverseProvider.validateStaticToken(auth);
  if (!valid) {
    console.error("Token rejected by /api/users/:me. Check DATAVERSE_TOKEN and DATAVERSE_SERVER.");
    process.exit(1);
  }
  console.log("Token accepted.");

  // ---- create the dataset ------------------------------------------------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let container;
  try {
    container = await dataverseProvider.createDataContainer(auth, {
      name: `DataPipe spike ${stamp}`,
      title: `DataPipe spike ${stamp}`,
      collectionAlias,
      authorName: "DataPipe, Spike",
      contactEmail: "spike@example.edu",
      description: "Throwaway dataset created by scripts/dataverse-spike.mjs. Safe to delete.",
    });
  } catch (e) {
    console.error(`createDataContainer failed: ${e.message}`);
    process.exit(1);
  }
  console.log(`Dataset created: id=${container.datasetId} doi=${container.persistentId}`);
  console.log(`  ${serverUrl}/dataset.xhtml?persistentId=${encodeURIComponent(container.persistentId)}`);

  // ---- GATE A: concurrent-write locking ----------------------------------
  // The named disqualifier. A class section submits 30-100 sessions to ONE
  // dataset within a minute; if writes serialize behind a lock at a rate that
  // cannot absorb that, Dataverse is out.
  const payload = JSON.stringify([{ trial_type: "html-keyboard-response", rt: 421 }]);
  // Every burst file gets DISTINCT content. Dataverse rejects files whose
  // content checksum matches one already in the dataset, so reusing one
  // payload confounds this gate: the failures look like lock contention when
  // they are really duplicate-content rejections. Verified live 2026-07-26.
  const burstPayload = (i) => JSON.stringify([{ trial_type: "html-keyboard-response", rt: 400 + i, session: `burst-${i}` }]);
  const started = Date.now();
  const writes = await Promise.all(
    Array.from({ length: burst }, (_, i) => {
      const p = burstPayload(i);
      return dataverseProvider
        .writeSessionFile(auth, container, `burst-${String(i).padStart(3, "0")}.json`, p, meta(p, "application/json"))
        .then((r) => r)
        .catch((e) => ({ success: false, error: "THREW", providerMessage: e.message }));
    })
  );
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const ok = writes.filter((w) => w.success);
  const bad = writes.filter((w) => !w.success);
  // Concurrent adds are rejected with a generic 400 "Failed to add file to
  // dataset.", NOT the 403 "dataset lock" the design doc anticipated -- so
  // count both signatures.
  const locked = bad.filter((w) => /dataset lock|failed to add file/i.test(w.providerMessage || ""));
  const dupeContent = bad.filter((w) => /same content/i.test(w.providerMessage || ""));
  if (dupeContent.length) {
    console.log(`      NOTE: ${dupeContent.length} rejected as duplicate CONTENT -- these are not lock failures.`);
  }
  const byError = bad.reduce((acc, w) => ({ ...acc, [w.error]: (acc[w.error] || 0) + 1 }), {});

  record(
    "GATE A - concurrent writes",
    bad.length === 0 ? "PASS" : locked.length > 0 ? "FAIL" : "INFO",
    `${ok.length}/${burst} succeeded in ${elapsed}s. ` +
      `${locked.length} lock rejections. ` +
      (bad.length ? `Failures by code: ${JSON.stringify(byError)}. Sample: ${bad[0].providerMessage}` : "No failures.")
  );
  if (locked.length > 0) {
    console.log("      Lock rejections are the disqualifying signal -- note the rate and whether the retry queue could absorb it.");
  }

  // ---- GATE B: tabular ingest suppression --------------------------------
  // We always send tabIngest="false". If a CSV still comes back as
  // tab-separated, Dataverse rewrote the researcher's data.
  const csv = "trial_type,rt\nhtml-keyboard-response,421\nhtml-keyboard-response,530\n";
  const csvWrite = await dataverseProvider.writeSessionFile(auth, container, "ingest-check.csv", csv, meta(csv, "text/csv"));
  if (!csvWrite.success) {
    record("GATE B - tabular ingest", "INFO", `CSV upload failed outright: ${csvWrite.providerMessage}`);
  } else {
    // Ingest is asynchronous; give it a moment before reading the type back.
    await new Promise((r) => setTimeout(r, 15000));
    const listing = await fetch(`${serverUrl}/api/datasets/${container.datasetId}/versions/:draft/files`, {
      headers: { "X-Dataverse-key": token },
    });
    const body = await listing.json();
    const entry = (body.data || []).find((f) => (f.label || "").startsWith("ingest-check"));
    const type = entry?.dataFile?.contentType;
    const ingested = type && /tab-separated/i.test(type);
    record(
      "GATE B - tabular ingest",
      ingested ? "FAIL" : "PASS",
      `Stored as label="${entry?.label}" contentType="${type}". ` +
        (ingested
          ? "Dataverse INGESTED the CSV despite tabIngest=false -- suppression is not honored on this installation."
          : "tabIngest=false was honored; the CSV was stored as-is.")
    );
  }

  // ---- GATE C: silent rename ---------------------------------------------
  // Confirms duplicates are renamed rather than rejected, and that we read the
  // stored name back rather than trusting the requested one.
  const a = await dataverseProvider.writeSessionFile(auth, container, "dupe.json", payload, meta(payload, "application/json"));
  const b = await dataverseProvider.writeSessionFile(auth, container, "dupe.json", payload, meta(payload, "application/json"));
  record(
    "GATE C - silent rename",
    a.success && b.success && b.storedFilename !== "dupe.json" ? "PASS" : "INFO",
    `First upload stored as "${a.storedFilename}", second as "${b.storedFilename}". ` +
      (b.storedFilename === "dupe.json"
        ? "Second upload kept the same name -- verify no data was overwritten."
        : "Rename detected and read back correctly from the response.")
  );

  // ---- updateFile: DELETE + re-add on a draft ----------------------------
  // /replace is unavailable on a never-published draft, so the adapter deletes
  // and re-adds. Confirm that actually works against a live server.
  const updated = JSON.stringify([{ trial_type: "updated", rt: 999 }]);
  const upd = await dataverseProvider.updateFile(auth, container, a.fileRef, updated, meta(updated, "application/json"));
  record(
    "updateFile (delete + re-add)",
    upd.success ? "PASS" : "FAIL",
    upd.success
      ? `Re-added as "${upd.storedFilename}" with new id ${upd.fileRef.id} (was ${a.fileRef.id}).`
      : `Failed: ${upd.error} ${upd.providerMessage}`
  );

  // ---- listing round-trip -------------------------------------------------
  const files = await dataverseProvider.listFiles(auth, container);
  record("listFiles", "INFO", `${files.length} files in the draft. Sample: ${files.slice(0, 3).map((f) => f.name).join(", ")}`);

  // ---- summary ------------------------------------------------------------
  console.log("\n==================== SUMMARY ====================");
  for (const r of results) console.log(`${r.verdict.padEnd(5)} ${r.gate}`);
  const failed = results.filter((r) => r.verdict === "FAIL");
  console.log(failed.length === 0 ? "\nNo gate failed." : `\n${failed.length} gate(s) FAILED -- see detail above.`);
  console.log(`\nDataset left in draft: ${serverUrl}/dataset.xhtml?persistentId=${encodeURIComponent(container.persistentId)}`);

  if (process.env.DATAVERSE_CLEANUP === "1") {
    const del = await fetch(`${serverUrl}/api/datasets/${container.datasetId}`, {
      method: "DELETE",
      headers: { "X-Dataverse-key": token },
    });
    console.log(del.ok ? "Cleanup: draft dataset deleted." : `Cleanup failed (${del.status}) -- delete it manually.`);
  }
}

main().catch((e) => {
  console.error("\nSpike aborted:", e);
  process.exit(1);
});

// Zenodo gating spike (docs/provider-migration-design.md).
//
// Drives the REAL shipping adapter (functions/lib/providers/zenodo.js) against
// a live Zenodo installation, so this validates our request shapes, response
// parsing and error mapping at the same time as it validates the service.
//
// Usage:
//   cd functions && npm run build && cd ..
//   ZENODO_TOKEN=xxxx node scripts/zenodo-spike.mjs
//
// Env:
//   ZENODO_TOKEN    (required) personal access token with deposit:write
//   ZENODO_SERVER   (default https://sandbox.zenodo.org)
//   ZENODO_BURST    (default 12) concurrent writes for gate C
//   ZENODO_CAP_TEST (set to 1 to run gate E, which uploads 101 files -- slow)
//   ZENODO_CLEANUP  (default 1; set to 0 to leave the deposition behind)
//
// Leaves the deposition UNPUBLISHED and never calls the publish action, so
// nothing here mints a DOI. With cleanup on, the draft is deleted at the end.

import { zenodoProvider } from "../functions/lib/providers/zenodo.js";

const token = process.env.ZENODO_TOKEN;
const serverUrl = process.env.ZENODO_SERVER || "https://sandbox.zenodo.org";
const burst = Number(process.env.ZENODO_BURST || 12);
const runCapTest = process.env.ZENODO_CAP_TEST === "1";
const cleanup = process.env.ZENODO_CLEANUP !== "0";

if (!token) {
  console.error("ZENODO_TOKEN is required. See the header of this file.");
  process.exit(1);
}

const auth = { token, serverUrl };
const results = [];
const record = (gate, verdict, detail) => {
  results.push({ gate, verdict, detail });
  console.log(`\n[${verdict}] ${gate}\n      ${detail}`);
};

const meta = (body) => ({ size: Buffer.byteLength(body), contentType: "application/json" });

// Distinct content per file, ALWAYS. The Dataverse spike initially reused one
// payload across a burst and Dataverse rejected the duplicates by checksum,
// which confounded the concurrency result entirely. Never reuse a payload in a
// burst again.
const payload = (label) => JSON.stringify({ label, at: new Date().toISOString(), pad: "x".repeat(64) });

async function main() {
  console.log(`Zenodo spike against ${serverUrl}   burst=${burst}\n`);

  const valid = await zenodoProvider.validateStaticToken(auth);
  if (!valid) {
    console.error("Token rejected. Check ZENODO_TOKEN's scopes (needs deposit:write) and ZENODO_SERVER.");
    process.exit(1);
  }
  console.log("Token accepted.");

  const container = await zenodoProvider.createDataContainer(auth, {
    title: `DataPipe spike ${new Date().toISOString()}`,
    creatorName: "DataPipe, Spike",
    description: "Automated gating spike. Never published; deleted after the run.",
  });
  console.log(`Deposition ${container.depositionId} created (draft).`);
  console.log(`Bucket ${container.bucketUrl}\n`);

  // ---- Gate A: does a bucket PUT to an existing key overwrite? -----------
  // The single most load-bearing unknown. Zenodo does not document it, and
  // InvenioRDM's native API requires an explicit delete first. updateFile
  // currently implements delete-then-PUT for safety; if this gate passes,
  // that collapses to one call and stops being non-atomic.
  {
    const first = payload("gate-a-first");
    const second = payload("gate-a-second");
    const w1 = await zenodoProvider.writeSessionFile(auth, container, "gate-a.json", first, meta(first));
    const w2 = await zenodoProvider.writeSessionFile(auth, container, "gate-a.json", second, meta(second));

    if (!w1.success) {
      record("A. bucket PUT overwrite", "FAIL", `first write failed: ${w1.providerStatus} ${w1.providerMessage}`);
    } else if (!w2.success) {
      record(
        "A. bucket PUT overwrite",
        "FAIL",
        `re-PUT to the same key was REJECTED (${w2.providerStatus} ${w2.providerMessage}). ` +
          "Keep updateFile's delete-then-PUT."
      );
    } else {
      const back = await zenodoProvider.downloadFile(auth, container, { name: "gate-a.json" });
      const overwrote = back.success && back.content === second;
      const files = await zenodoProvider.listFiles(auth, container);
      const copies = files.filter((f) => f.name === "gate-a.json").length;
      record(
        "A. bucket PUT overwrite",
        overwrote && copies === 1 ? "PASS" : "FAIL",
        overwrote && copies === 1
          ? "PUT to an existing key replaced it in place, one entry in the listing. updateFile can drop its delete."
          : `content-matched=${overwrote} listing-copies=${copies}. Keep delete-then-PUT.`
      );
    }
  }

  // ---- Gate B: slashed paths -------------------------------------------
  // ORIGINAL QUESTION: does a key containing "/" round-trip verbatim?
  // ANSWERED, NO (2026-08-11): Zenodo's keyspace is flat and a slash cannot
  // be stored by any route -- bucket PUT 404s whether the slash is literal or
  // %2F-encoded, and the legacy multipart endpoint returns 201 while silently
  // storing "data/raw/x.json" as "data_raw_x.json".
  //
  // So the adapter flattens deliberately (toZenodoKey) and this gate now
  // checks the thing that actually matters: that the name the adapter REPORTS
  // storing is the name Zenodo actually holds. The collision cache matches
  // names EXACTLY, so any drift between those two silently breaks dedup --
  // the same class of bug as Dataverse's dropped directoryLabel.
  {
    const key = "data/raw/gate-b.json";
    const expected = "data_raw_gate-b.json";
    const body = payload("gate-b");
    const w = await zenodoProvider.writeSessionFile(auth, container, key, body, meta(body));
    if (!w.success) {
      record("B. slashed key flattening", "FAIL", `write rejected: ${w.providerStatus} ${w.providerMessage}`);
    } else {
      const files = await zenodoProvider.listFiles(auth, container);
      const found = files.find((f) => f.name === w.storedFilename);
      const back = await zenodoProvider.downloadFile(auth, container, { name: w.storedFilename });
      const agrees = w.storedFilename === expected && !!found && back.success && back.content === body;
      record(
        "B. slashed key flattening",
        agrees ? "PASS" : "FAIL",
        `requested="${key}" stored="${w.storedFilename}" (expected "${expected}") ` +
          `listed=${found ? `"${found.name}"` : "NOT FOUND"} readback=${back.success && back.content === body}`
      );
    }
  }

  // ---- Gate C: concurrent writes to one deposition ----------------------
  // The gate Dataverse failed: it accepts exactly ONE concurrent write per
  // dataset and rejects the rest with a 400. Zenodo's bucket is object
  // storage, so the expectation is that all of these succeed -- but that is
  // exactly the kind of expectation this spike exists to check rather than
  // assume.
  {
    const started = Date.now();
    const writes = await Promise.all(
      Array.from({ length: burst }, (_, i) => {
        const body = payload(`gate-c-${i}`);
        return zenodoProvider.writeSessionFile(auth, container, `gate-c-${i}.json`, body, meta(body));
      })
    );
    const elapsed = Date.now() - started;
    const ok = writes.filter((w) => w.success).length;
    const byCode = {};
    for (const w of writes) {
      if (!w.success) byCode[w.error] = (byCode[w.error] || 0) + 1;
    }
    const files = await zenodoProvider.listFiles(auth, container);
    const landed = files.filter((f) => f.name.startsWith("gate-c-")).length;

    record(
      "C. concurrent writes",
      ok === burst && landed === burst ? "PASS" : ok > burst / 2 ? "PARTIAL" : "FAIL",
      `${ok}/${burst} accepted, ${landed}/${burst} present in the listing, ${elapsed}ms wall clock` +
        (Object.keys(byCode).length ? `, failures: ${JSON.stringify(byCode)}` : "")
    );
  }

  // ---- Gate D: is files-archive available on an UNPUBLISHED draft? ------
  // If it is, the finalization step needs no code at all: the researcher gets
  // a server-built zip of the whole record on demand. If it is published-only,
  // the clean-final-structure plan depends on publishing first.
  {
    const response = await fetch(`${serverUrl}/api/records/${container.depositionId}/draft/files-archive`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    record(
      "D. files-archive on a draft",
      response.status === 200 ? "PASS" : "INFO",
      `GET /api/records/${container.depositionId}/draft/files-archive -> ${response.status} ` +
        `(content-type: ${response.headers.get("content-type")}). ` +
        (response.status === 200
          ? "Draft-stage bulk download works."
          : "Not available pre-publication; finalization must publish first.")
    );
  }

  // ---- Gate E (opt-in): what happens at the 101st file? -----------------
  // Confirms the cap is real and that the adapter maps the refusal to
  // QUOTA_EXCEEDED rather than a generic UNAVAILABLE -- the queue treats
  // those very differently.
  if (runCapTest) {
    const existing = (await zenodoProvider.listFiles(auth, container)).length;
    let firstRefusal = null;
    for (let i = existing; i < 105; i++) {
      const body = payload(`cap-${i}`);
      const w = await zenodoProvider.writeSessionFile(auth, container, `cap-${i}.json`, body, meta(body));
      if (!w.success) {
        firstRefusal = { at: i + 1, ...w };
        break;
      }
    }
    record(
      "E. 100-file cap",
      firstRefusal ? (firstRefusal.error === "QUOTA_EXCEEDED" ? "PASS" : "PARTIAL") : "INFO",
      firstRefusal
        ? `refused at file ${firstRefusal.at}: ${firstRefusal.providerStatus} "${firstRefusal.providerMessage}" -> mapped ${firstRefusal.error}`
        : "no refusal up to 105 files -- the documented 100-file cap did not bite here"
    );
  } else {
    console.log("\n[SKIP] E. 100-file cap (set ZENODO_CAP_TEST=1 to run)");
  }

  // ---- cleanup ----------------------------------------------------------
  if (cleanup) {
    const del = await fetch(`${serverUrl}/api/deposit/depositions/${container.depositionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`\nCleanup: DELETE deposition ${container.depositionId} -> ${del.status}`);
  } else {
    console.log(`\nLeaving deposition ${container.depositionId} in place (ZENODO_CLEANUP=0).`);
  }

  console.log("\n==== SUMMARY ====");
  for (const r of results) {
    console.log(`${r.verdict.padEnd(8)} ${r.gate}`);
  }
  const failed = results.filter((r) => r.verdict === "FAIL");
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("\nSpike aborted:", e);
  process.exit(1);
});

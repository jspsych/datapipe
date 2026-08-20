// End-to-end check of compaction + finalization against a DEPLOYED DataPipe.
//
// Everything here drives the real HTTP API rather than the dashboard, because
// /api/data is a public endpoint by design (participants' browsers post to it)
// -- so the whole load and most of the verification needs no credentials at
// all. The parts that do are optional and skip cleanly.
//
// Usage:
//   EXPERIMENT_ID=xxxx node scripts/live-check.mjs
//
// Env:
//   EXPERIMENT_ID   (required) an experiment on a capped provider, metadata ON
//   BASE_URL        (default https://datapipe-test.web.app)
//   ZENODO_TOKEN    (optional) sandbox token -- enables deposition-side checks
//   DEPOSITION_ID   (optional) required with ZENODO_TOKEN
//   ZENODO_SERVER   (default https://sandbox.zenodo.org)
//   ID_TOKEN        (optional) Firebase ID token -- enables the finalize phase
//   MAX_SUBMISSIONS (default 60) safety stop
//
// Without ZENODO_TOKEN this still proves the load path, duplicate rejection
// after archiving, and post-finalization rejection -- all observable from the
// public API. What it cannot see is the archive's CONTENTS, which is the whole
// point of the feature, so supply the token if you can.

import { readArchive } from "../functions/lib/archive-reader.js";

const BASE = process.env.BASE_URL || "https://datapipe-test.web.app";
const EXP = process.env.EXPERIMENT_ID;
const ZTOKEN = process.env.ZENODO_TOKEN;
const DEPOSITION = process.env.DEPOSITION_ID;
const ZSERVER = process.env.ZENODO_SERVER || "https://sandbox.zenodo.org";
const ID_TOKEN = process.env.ID_TOKEN;
const MAX_SUBMISSIONS = Number(process.env.MAX_SUBMISSIONS || 60);

if (!EXP) {
  console.error("EXPERIMENT_ID is required. See the header of this file.");
  process.exit(1);
}

const results = [];
const record = (step, verdict, detail) => {
  results.push({ step, verdict, detail });
  console.log(`\n[${verdict}] ${step}\n      ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);

async function submit(filename, data) {
  const res = await fetch(`${BASE}/api/data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ experimentID: EXP, filename, data }),
  });
  let body;
  try { body = await res.json(); } catch { body = { raw: "<non-json>" }; }
  return { status: res.status, body };
}

// Deposition-side view. Null when no token was supplied, so every caller has
// to treat "cannot see" as distinct from "saw nothing".
async function listDeposition() {
  if (!ZTOKEN || !DEPOSITION) return null;
  const res = await fetch(`${ZSERVER}/api/deposit/depositions/${DEPOSITION}/files`, {
    headers: { Authorization: `Bearer ${ZTOKEN}` },
  });
  if (!res.ok) throw new Error(`deposition listing failed: ${res.status}`);
  return (await res.json()).map((f) => f.filename ?? f.key);
}

async function fetchArchive(name) {
  const res = await fetch(`${ZSERVER}/api/files/${BUCKET}/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${ZTOKEN}` },
  });
  if (!res.ok) throw new Error(`archive download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

let BUCKET = null;
async function resolveBucket() {
  if (!ZTOKEN || !DEPOSITION) return;
  const res = await fetch(`${ZSERVER}/api/deposit/depositions/${DEPOSITION}`, {
    headers: { Authorization: `Bearer ${ZTOKEN}` },
  });
  if (res.ok) BUCKET = (await res.json())?.links?.bucket?.split("/").pop() ?? null;
}

async function main() {
  console.log(`Live check against ${BASE}\n  experiment ${EXP}`);
  await resolveBucket();
  console.log(`  deposition ${DEPOSITION ?? "<not supplied -- Zenodo-side checks will skip>"}\n`);

  // ---- 1. does a single submission land? --------------------------------
  // Before anything else, because if the write path is broken every later
  // signal is noise. Also the first evidence the compaction trigger fires --
  // it runs on the experiment document update this causes.
  const before = await listDeposition();
  const first = await submit(`live-${stamp}-1.json`, JSON.stringify([{ trial: 1, rt: 401 }]));
  record(
    "1. single submission",
    first.status === 201 ? "PASS" : "FAIL",
    `HTTP ${first.status} ${JSON.stringify(first.body).slice(0, 160)}` +
      (first.status === 202 ? "  <-- QUEUED, not written; check the queue panel before continuing" : "")
  );
  if (first.status !== 201) {
    return finish();
  }

  if (before) {
    await sleep(3000);
    const after = await listDeposition();
    record(
      "2. files appeared on the provider",
      after.length > before.length ? "PASS" : "FAIL",
      `deposition went ${before.length} -> ${after.length} files`
    );
  } else {
    console.log("\n[SKIP] 2. provider-side file count (no ZENODO_TOKEN/DEPOSITION_ID)");
  }

  // ---- 3. drive past the compaction watermark ---------------------------
  // 80 files on Zenodo. A metadata-active submission writes 2 (raw + main CSV)
  // when the data has no nested columns, so this is ~39 submissions -- but it
  // polls rather than assuming, because sidecar count depends on the data.
  const archived = [];
  let submitted = 1;
  let sawArchive = null;
  for (let i = 2; i <= MAX_SUBMISSIONS; i++) {
    const name = `live-${stamp}-${i}.json`;
    const r = await submit(name, JSON.stringify([{ trial: 1, rt: 400 + i }]));
    submitted++;
    if (r.status !== 201) {
      record("3. load", "FAIL", `submission ${i} returned HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      break;
    }
    archived.push(name);
    process.stdout.write(".");
    await sleep(250);

    if (i % 5 === 0) {
      const files = await listDeposition();
      if (files) {
        const zip = files.find((f) => /^datapipe-batch-\d{4}\.zip$/.test(f));
        if (zip) { sawArchive = { zip, files }; break; }
      }
    }
  }
  console.log("");

  if (ZTOKEN && DEPOSITION) {
    // Compaction is asynchronous -- the trigger fires on the submission that
    // crosses the watermark, so give it room to finish before judging.
    for (let waited = 0; waited < 120 && !sawArchive; waited += 10) {
      await sleep(10000);
      const files = await listDeposition();
      const zip = files.find((f) => /^datapipe-batch-\d{4}\.zip$/.test(f));
      if (zip) sawArchive = { zip, files };
    }
    record(
      "3. compaction ran",
      sawArchive ? "PASS" : "FAIL",
      sawArchive
        ? `after ${submitted} submissions: ${sawArchive.zip} present, ${sawArchive.files.length} files on the deposition`
        : `after ${submitted} submissions no batch archive appeared -- check the onexperimentgrew logs`
    );
  }

  // ---- 4. does the archive carry the Psych-DS tree? ---------------------
  // The reason the feature exists. Zenodo cannot store a slash, so the paths
  // only exist inside the zip.
  if (sawArchive && BUCKET) {
    const zip = await fetchArchive(sawArchive.zip);
    const entries = readArchive(zip);
    const names = [...entries.keys()];
    const nested = names.filter((n) => n.startsWith("data/raw/"));
    record(
      "4. Psych-DS paths inside the archive",
      nested.length > 0 ? "PASS" : "FAIL",
      `${entries.size} members; ${nested.length} under data/raw/  e.g. ${names.slice(0, 3).join(", ")}`
    );
  }

  // ---- 5. are archived filenames still claimed? -------------------------
  // The silent one. These files now exist ONLY inside the zip, so if the
  // sealed claims were lost the resubmission below is accepted as new and the
  // duplicate quietly lands.
  if (sawArchive) {
    const loose = sawArchive.files;
    const gone = archived.find((n) => !loose.includes(n));
    if (gone) {
      const dup = await submit(gone, JSON.stringify([{ trial: 1 }]));
      record(
        "5. duplicate rejected after archiving",
        dup.status === 400 ? "PASS" : "FAIL",
        `resubmitted ${gone} (now only inside the archive) -> HTTP ${dup.status}` +
          (dup.status === 201 ? "  <-- ACCEPTED. Sealed claims are not working; this is data loss." : "")
      );
    }
  }

  // ---- 6. finalize ------------------------------------------------------
  if (ID_TOKEN) {
    const res = await fetch(`${BASE}/api/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ID_TOKEN}` },
      body: JSON.stringify({ experimentID: EXP }),
    });
    const body = await res.text();
    record(
      "6. finalize accepted",
      res.status === 202 ? "PASS" : "FAIL",
      `HTTP ${res.status} ${body.slice(0, 200)}`
    );

    if (res.status === 202) {
      await sleep(60000);
      const post = await submit(`live-${stamp}-after-final.json`, JSON.stringify([{ trial: 1 }]));
      record(
        "7. finalized experiment rejects submissions",
        post.status === 400 ? "PASS" : "FAIL",
        `HTTP ${post.status} ${JSON.stringify(post.body).slice(0, 160)}`
      );
    }
  } else {
    console.log("\n[SKIP] 6-7. finalize (no ID_TOKEN)");
  }

  finish();
}

function finish() {
  console.log("\n==== SUMMARY ====");
  for (const r of results) console.log(`${r.verdict.padEnd(6)} ${r.step}`);
  process.exit(results.some((r) => r.verdict === "FAIL") ? 1 : 0);
}

main().catch((e) => {
  console.error("\nLive check aborted:", e);
  process.exit(1);
});

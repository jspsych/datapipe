// Google Drive gating spike (docs/provider-migration-design.md).
//
// Drives the REAL shipping adapter (functions/lib/providers/gdrive.js)
// against a live Google Drive, exactly the way scripts/zenodo-spike.mjs and
// scripts/dataverse-spike.mjs do for their providers -- so this validates our
// request shapes, response parsing and error mapping at the same time as it
// validates the service.
//
// Drive is the ONLY provider that had never been spiked before this file: 28
// unit/emulator tests against Dataverse's 72, and every adapter-level bug
// found in this migration so far came from a spike, invisible to mocks built
// from the same assumptions as the code they test.
//
// Usage:
//   cd functions && npm run build && cd ..
//   GDRIVE_TOKEN=xxxx node scripts/gdrive-spike.mjs
//
// Getting a GDRIVE_TOKEN:
//   1. Open https://developers.google.com/oauthplayground
//   2. Click the gear icon (top right) -> check "Use your own OAuth
//      credentials" -> paste a Client ID/Secret from a Google Cloud project
//      that has the Drive API enabled (or leave unchecked to use Google's
//      shared test credentials, which also works for this scope).
//   3. In "Step 1: Select & authorize APIs", enter the scope by hand:
//        https://www.googleapis.com/auth/drive.file
//      (this is the exact scope gdrive.ts requests -- see oauthConfig() in
//      functions/src/providers/gdrive.ts) and click "Authorize APIs".
//   4. Sign in and consent with the Google account you want to spike against.
//   5. In "Step 2: Exchange authorization code for tokens", click "Exchange
//      authorization code for tokens" and copy the resulting Access token.
//      It expires in ~1 hour -- re-run step 5 to mint a fresh one if a run
//      takes longer than that.
//
// The spike constructs `auth = { token }` directly, the same shortcut every
// other spike takes -- gdrive.ts's own resolveToken() (decrypt + refresh via
// Firestore) is a production concern this script deliberately bypasses.
//
// Env:
//   GDRIVE_TOKEN     (required) an OAuth2 access token with the drive.file
//                     scope, minted as described above
//   GDRIVE_API_BASE   (default https://www.googleapis.com)
//   GDRIVE_BURST      (default 8) concurrent writes for gate H
//   GDRIVE_CLEANUP    (default 1; set to 0 to leave the experiment folder
//                      behind for manual inspection)
//
// Everything this script creates lives under one fresh "DataPipe spike
// <timestamp>" folder (created via the adapter's own createDataContainer, the
// same call create-experiment.ts makes). With cleanup on, that single folder
// is deleted (Drive cascades the delete to every file/subfolder inside it);
// the shared "DataPipe" root folder above it is never touched, since real
// experiments share it too.

import { gdriveProvider } from "../functions/lib/providers/gdrive.js";

const token = process.env.GDRIVE_TOKEN;
const apiBase = process.env.GDRIVE_API_BASE || "https://www.googleapis.com";
const burst = Number(process.env.GDRIVE_BURST || 8);
const cleanup = process.env.GDRIVE_CLEANUP !== "0";

if (!token) {
  console.error(
    "GDRIVE_TOKEN is required. See the header of this file for how to mint one " +
      "(Google OAuth Playground, https://www.googleapis.com/auth/drive.file scope)."
  );
  process.exit(1);
}

// getApiBase() in gdrive.ts reads process.env.GDRIVE_API_BASE at CALL time,
// so setting it here (even to its own default) is enough to make the adapter
// agree with this script about which host it's talking to.
process.env.GDRIVE_API_BASE = apiBase;

const auth = { token };
const results = [];
const record = (gate, verdict, detail) => {
  results.push({ gate, verdict, detail });
  console.log(`\n[${verdict}] ${gate}\n      ${detail}`);
};

const meta = (body, contentType = "application/json") => ({
  size: Buffer.byteLength(body),
  contentType,
});

const payload = (label) => JSON.stringify({ label, at: new Date().toISOString(), pad: "x".repeat(64) });

// Raw Drive call, used only where the adapter has no method that answers the
// question directly (there is no gdriveProvider.validateStaticToken -- Drive
// is oauth2, not a static-token provider -- and no downloadFileBytes/delete
// method to inspect the API's own pagination contract with). Never used to
// bypass the adapter for anything the adapter itself does.
async function driveFetch(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  return response;
}

async function main() {
  console.log(`Google Drive spike against ${apiBase}   burst=${burst}\n`);

  // ---- sanity: does the token work at all --------------------------------
  // No validateStaticToken on this adapter (oauth2, not static-token), so ask
  // Drive directly with the same "about" call the Picker UI relies on.
  const about = await driveFetch("/drive/v3/about?fields=user");
  if (!about.ok) {
    console.error(
      `Token rejected: GET /drive/v3/about -> ${about.status} ${about.statusText}. ` +
        "Check GDRIVE_TOKEN's scope (needs drive.file) and that it hasn't expired (~1hr lifetime)."
    );
    process.exit(1);
  }
  const aboutBody = await about.json();
  console.log(`Token accepted. Signed in as ${aboutBody.user?.emailAddress ?? "(unknown)"}.`);

  // ---- create the experiment folder --------------------------------------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const container = await gdriveProvider.createDataContainer(auth, { name: `DataPipe spike ${stamp}` });
  console.log(`Experiment folder created: id=${container.folderId}`);
  console.log(`  https://drive.google.com/drive/folders/${container.folderId}\n`);

  // ---- Gate A: duplicate filenames ----------------------------------------
  // gdrive.ts's central load-bearing claim: "Drive never yields a
  // duplicate-name conflict (NAME_CONFLICT): Drive allows multiple files with
  // the same name in the same folder, so the collision cache (not the
  // provider) is the only duplicate gate for gdrive experiments." If Drive
  // actually rejects or silently de-duplicates a repeat name, that claim is
  // wrong and the whole reliance on the Firestore cache as the ONLY backstop
  // is unsound.
  {
    const first = payload("gate-a-first");
    const second = payload("gate-a-second");
    const w1 = await gdriveProvider.writeSessionFile(auth, container, "gate-a.json", first, meta(first));
    const w2 = await gdriveProvider.writeSessionFile(auth, container, "gate-a.json", second, meta(second));

    if (!w1.success || !w2.success) {
      record(
        "A. duplicate filenames",
        "FAIL",
        `write(s) rejected: first.success=${w1.success} second.success=${w2.success}` +
          (w1.success ? "" : ` first: ${w1.providerStatus} ${w1.providerMessage}`) +
          (w2.success ? "" : ` second: ${w2.providerStatus} ${w2.providerMessage}`)
      );
    } else {
      const listed = await gdriveProvider.listFiles(auth, container);
      const copies = listed.filter((f) => f.name === "gate-a.json");
      const distinctIds = new Set(copies.map((f) => f.id));
      const ok = w1.fileRef.id !== w2.fileRef.id && copies.length === 2 && distinctIds.size === 2;
      record(
        "A. duplicate filenames",
        ok ? "PASS" : "FAIL",
        `both writes succeeded, ids ${w1.fileRef.id} and ${w2.fileRef.id}; ` +
          `folder listing shows ${copies.length} entr${copies.length === 1 ? "y" : "ies"} named "gate-a.json" ` +
          `(${distinctIds.size} distinct id${distinctIds.size === 1 ? "" : "s"}).` +
          (ok
            ? " Drive genuinely allows and keeps both -- the Firestore cache really is the only gate."
            : "  <-- Drive rejected, merged, or otherwise did not keep two independent copies.")
      );
    }
  }

  // ---- Gate B: recursive listing collects the LEAF name -------------------
  // listFiles does a BFS through subfolders and reports every file under its
  // bare leaf name regardless of depth, because storedNameFor collapses a
  // path to its leaf and that's what the collision cache hashes. If listFiles
  // instead reported a qualified/full path, cold-cache rehydration would
  // never match a claim made on the leaf, and duplicates would slip through
  // silently (Drive has no NAME_CONFLICT to fall back on -- see gate A).
  {
    const body = payload("gate-b");
    const w = await gdriveProvider.writeSessionFile(auth, container, "data/raw/subject-1.json", body, meta(body));
    if (!w.success) {
      record("B. recursive listing / leaf-name collection", "FAIL", `write rejected: ${w.providerStatus} ${w.providerMessage}`);
    } else {
      const listed = await gdriveProvider.listFiles(auth, container);
      const found = listed.find((f) => f.id === w.fileRef.id);
      const ok = !!found && found.name === "subject-1.json";
      record(
        "B. recursive listing / leaf-name collection",
        ok ? "PASS" : "FAIL",
        `wrote to "data/raw/subject-1.json"; listFiles found ` +
          (found ? `it reported as name="${found.name}"` : "NO entry with a matching id at all") +
          (ok
            ? ` (expected "subject-1.json", the bare leaf -- matches storedNameFor).`
            : `  <-- either the file is missing from the recursive listing, or it is not reported under its leaf name.`)
      );
    }
  }

  // ---- Gate C: nested folder creation --------------------------------------
  // Writing "data/raw/x.json" must create the folder CHAIN (not just one
  // level), and the file must land in the deepest folder, not an intermediate
  // one. Confirmed here with raw folder queries rather than trusting gate B's
  // listFiles round-trip alone, since listFiles recursing correctly and the
  // folder structure being correct are two different claims.
  {
    const dataFolder = await driveFetch(
      `/drive/v3/files?q=${encodeURIComponent(`name='data' and '${container.folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&supportsAllDrives=true&includeItemsFromAllDrives=true`
    ).then((r) => r.json());
    const dataId = dataFolder.files?.[0]?.id;

    let rawId = null;
    let fileInRaw = null;
    if (dataId) {
      const rawFolder = await driveFetch(
        `/drive/v3/files?q=${encodeURIComponent(`name='raw' and '${dataId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&supportsAllDrives=true&includeItemsFromAllDrives=true`
      ).then((r) => r.json());
      rawId = rawFolder.files?.[0]?.id;

      if (rawId) {
        const contents = await driveFetch(
          `/drive/v3/files?q=${encodeURIComponent(`'${rawId}' in parents and trashed=false`)}&supportsAllDrives=true&includeItemsFromAllDrives=true`
        ).then((r) => r.json());
        fileInRaw = (contents.files || []).find((f) => f.name === "subject-1.json");
      }
    }

    const ok = !!dataId && !!rawId && !!fileInRaw;
    record(
      "C. nested folder creation",
      ok ? "PASS" : "FAIL",
      `"data" folder ${dataId ? `exists (${dataId})` : "MISSING"}; ` +
        `"data/raw" folder ${rawId ? `exists (${rawId})` : "MISSING"}; ` +
        `subject-1.json ${fileInRaw ? "is inside the deepest folder" : "NOT found in data/raw"}.`
    );
  }

  // ---- Gate D: pagination CONTRACT (not the adapter's own loop) -----------
  // Creating 1000+ files to exercise listFiles' own pageSize=1000 loop is
  // impractical. Instead, query the API directly with a small pageSize
  // against files already created by gates A-C and confirm nextPageToken
  // behaves the way listFiles assumes (appears when more remain, advances
  // between requests, absent on the last page). This is a genuine gap
  // between "the contract holds" and "the adapter's own loop was exercised" --
  // recorded as INFO, not PASS, so that gap stays visible.
  {
    const page1 = await driveFetch(
      `/drive/v3/files?q=${encodeURIComponent(`'${container.folderId}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`
    ).then((r) => r.json());

    if (!page1.nextPageToken) {
      record(
        "D. pagination contract",
        "INFO",
        `Only ${page1.files?.length ?? 0} top-level entr${(page1.files?.length ?? 0) === 1 ? "y" : "ies"} in the ` +
          "experiment folder at this point in the run -- not enough to force a second page with pageSize=1. " +
          "Cannot exercise the contract here; run gate A/B before this gate or add more top-level writes."
      );
    } else {
      const page2 = await driveFetch(
        `/drive/v3/files?q=${encodeURIComponent(`'${container.folderId}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name)&pageSize=1&pageToken=${encodeURIComponent(page1.nextPageToken)}&supportsAllDrives=true&includeItemsFromAllDrives=true`
      ).then((r) => r.json());
      const advanced = page2.nextPageToken !== page1.nextPageToken;
      record(
        "D. pagination contract",
        "INFO",
        `Confirmed the CONTRACT with a raw pageSize=1 query: page 1 returned nextPageToken="${page1.nextPageToken}", ` +
          `page 2 (using it) returned nextPageToken="${page2.nextPageToken ?? "(absent)"}" (token ${advanced ? "advanced" : "DID NOT ADVANCE"}). ` +
          "This is NOT a PASS on the adapter's own do/while loop (pageSize=1000, never exercised at scale here) -- " +
          "just confirmation that the API contract listFiles' loop relies on is real."
      );
    }
  }

  // ---- Gate E: updateFile semantics ----------------------------------------
  // Confirms the media-PATCH actually replaces content in place, and whether
  // the file id survives the update -- metadata-block.ts stores that id
  // across submissions and PATCHes it again on the next one, so an id that
  // changes on update would silently orphan every later metadata write.
  {
    const original = payload("gate-e-original");
    const w = await gdriveProvider.writeSessionFile(auth, container, "gate-e.json", original, meta(original));
    if (!w.success) {
      record("E. updateFile semantics", "FAIL", `initial write rejected: ${w.providerStatus} ${w.providerMessage}`);
    } else {
      const updated = payload("gate-e-updated");
      const upd = await gdriveProvider.updateFile(auth, container, w.fileRef, updated, meta(updated));
      if (!upd.success) {
        record("E. updateFile semantics", "FAIL", `update rejected: ${upd.providerStatus} ${upd.providerMessage}`);
      } else {
        const back = await gdriveProvider.downloadFile(auth, container, upd.fileRef);
        const listed = await gdriveProvider.listFiles(auth, container);
        const copies = listed.filter((f) => f.name === "gate-e.json");
        const idStable = upd.fileRef.id === w.fileRef.id;
        const contentReplaced = back.success && back.content === updated;
        const noNewCopy = copies.length === 1;
        const ok = idStable && contentReplaced && noNewCopy;
        record(
          "E. updateFile semantics",
          ok ? "PASS" : "FAIL",
          `id stable=${idStable} (${w.fileRef.id} -> ${upd.fileRef.id}); content replaced in place=${contentReplaced}; ` +
            `exactly one "gate-e.json" in the listing after update=${noNewCopy} (found ${copies.length}).`
        );
      }
    }
  }

  // ---- Gate F: binary fidelity ---------------------------------------------
  // gdrive.ts has no downloadFileBytes (maxFileCount is null, so the
  // StorageProvider interface does not require one) -- its only read path,
  // downloadFile, decodes the response as UTF-8 text, which is lossy for
  // invalid-UTF-8 bytes by construction (same as every other adapter's
  // downloadFile). That's fine for this adapter's only real caller
  // (metadata-block.ts reads back JSON), but this gate checks the layer below
  // that: whether DRIVE ITSELF stores and returns the bytes intact, by
  // reading the raw response body directly rather than through
  // response.text(). If Drive corrupts the bytes server-side, no adapter-side
  // fix would help; if only the text() decode is lossy, that's expected and
  // not a bug.
  {
    const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01, 0x80, 0xc0, 0xfd, 0x00, 0x00]);
    const w = await gdriveProvider.writeSessionFile(auth, container, "gate-f.bin", raw, {
      size: raw.length,
      contentType: "application/octet-stream",
    });
    if (!w.success) {
      record("F. binary fidelity", "FAIL", `write rejected: ${w.providerStatus} ${w.providerMessage}`);
    } else {
      const rawResponse = await driveFetch(`/drive/v3/files/${w.fileRef.id}?alt=media&supportsAllDrives=true`);
      const backBytes = Buffer.from(await rawResponse.arrayBuffer());
      const exact = Buffer.compare(backBytes, raw) === 0;

      const viaAdapter = await gdriveProvider.downloadFile(auth, container, w.fileRef);
      const adapterLossy = !viaAdapter.success || Buffer.compare(Buffer.from(viaAdapter.content, "utf8"), raw) !== 0;

      record(
        "F. binary fidelity",
        exact ? "PASS" : "FAIL",
        `raw byte-for-byte round trip (bypassing downloadFile's text() decode)=${exact}; ` +
          `downloadFile (the adapter's only read path) is lossy-as-expected=${adapterLossy}` +
          (exact
            ? " -- Drive itself preserves bytes; the adapter has no lossless read method today, which is fine for its current caller (JSON-only metadata reads)."
            : "  <-- Drive corrupted the bytes server-side, independent of any adapter behavior.")
      );
    }
  }

  // ---- Gate G: error mapping -----------------------------------------------
  {
    // G1: invalid token -> AUTH_EXPIRED (the minimum required check).
    const badAuth = { token: "definitely-not-a-valid-token" };
    const body = payload("gate-g1");
    const w1 = await gdriveProvider.writeSessionFile(badAuth, container, "gate-g1.json", body, meta(body));
    record(
      "G1. invalid token -> AUTH_EXPIRED",
      !w1.success && w1.error === "AUTH_EXPIRED" ? "PASS" : "FAIL",
      `success=${w1.success} error=${w1.error ?? "(none)"} providerStatus=${w1.providerStatus ?? "(none)"}`
    );

    // G2: write into a folder id that doesn't exist -> the code has no
    // explicit case for a Drive 404 (mapDriveError's only branches are
    // 401/403/429; everything else falls through to UNAVAILABLE) -- confirm
    // that's really what a real 404 does, safely (a bad-folder write, not a
    // quota-exhausting one).
    const ghostContainer = { provider: "gdrive", folderId: "0000000000000000000ghost" };
    const body2 = payload("gate-g2");
    const w2 = await gdriveProvider.writeSessionFile(auth, ghostContainer, "gate-g2.json", body2, meta(body2));
    record(
      "G2. nonexistent parent folder -> mapped error",
      !w2.success ? (w2.error === "UNAVAILABLE" ? "PASS" : "INFO") : "FAIL",
      w2.success
        ? "write UNEXPECTEDLY succeeded against a folder id that should not exist"
        : `success=false error=${w2.error} providerStatus=${w2.providerStatus} providerMessage="${w2.providerMessage}" ` +
          (w2.error === "UNAVAILABLE"
            ? "(falls through mapDriveError's default branch, as read from the source)"
            : "(mapped differently than the 401/403/429/default branches in mapDriveError predict -- worth a closer look)")
      );

    // G3: updateFile against a fileRef id that doesn't exist -> same
    // fall-through-to-UNAVAILABLE question, on the PATCH path instead of POST.
    const ghostFileRef = { id: "0000000000000000000ghostfile", name: "ghost.json" };
    const body3 = payload("gate-g3");
    const w3 = await gdriveProvider.updateFile(auth, container, ghostFileRef, body3, meta(body3));
    record(
      "G3. updateFile on a nonexistent file id -> mapped error",
      !w3.success ? (w3.error === "UNAVAILABLE" ? "PASS" : "INFO") : "FAIL",
      w3.success
        ? "update UNEXPECTEDLY succeeded against a file id that should not exist"
        : `success=false error=${w3.error} providerStatus=${w3.providerStatus} providerMessage="${w3.providerMessage}"`
    );
  }

  // ---- Gate H: concurrent writes into the SAME NEW nested subfolder -------
  // Found while reading the adapter, not in the original brief: writeSessionFile
  // walks a path's segments through findOrCreateFolder, which is find-THEN-
  // create -- two calls, not one atomic operation. A burst of concurrent
  // writes to a path whose intermediate folder does not exist YET can each
  // see "not found" and each create their own copy, leaving Drive with
  // multiple folders sharing the same name at the same level. listFiles would
  // still find every file (it recurses into every folder it discovers,
  // duplicates included), so this would not by itself cause a MISSED
  // duplicate the way gate A's question would -- but it would leave the
  // Drive folder structure duplicated and confusing, and is worth knowing
  // about regardless.
  {
    const label = `gate-h-${Date.now()}`;
    const writes = await Promise.all(
      Array.from({ length: burst }, (_, i) => {
        const body = payload(`gate-h-${i}`);
        return gdriveProvider.writeSessionFile(auth, container, `${label}/file-${i}.json`, body, meta(body));
      })
    );
    const ok = writes.filter((w) => w.success).length;

    const folderListing = await driveFetch(
      `/drive/v3/files?q=${encodeURIComponent(`name='${label}' and '${container.folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&supportsAllDrives=true&includeItemsFromAllDrives=true`
    ).then((r) => r.json());
    const folderCount = (folderListing.files || []).length;

    const listed = await gdriveProvider.listFiles(auth, container);
    const filesLanded = listed.filter((f) => f.name.startsWith("file-")).length;

    record(
      "H. concurrent writes into a new shared subfolder (race in findOrCreateFolder)",
      ok === burst && folderCount === 1 ? "PASS" : folderCount > 1 ? "PARTIAL" : "FAIL",
      `${ok}/${burst} writes succeeded; Drive now has ${folderCount} folder(s) named "${label}" ` +
        `under the experiment root; listFiles still reports ${filesLanded}/${burst} of this gate's files ` +
        "(recursion finds every folder regardless of duplication)." +
        (folderCount > 1
          ? "  <-- findOrCreateFolder raced: concurrent submissions to a brand-new nested path can " +
            "fragment into sibling folders with the same name. Files are not lost (listFiles still finds " +
            "them all), but the folder structure a researcher sees in Drive is duplicated."
          : "")
    );
  }

  // ---- cleanup --------------------------------------------------------------
  if (cleanup) {
    const del = await driveFetch(`/drive/v3/files/${container.folderId}?supportsAllDrives=true`, { method: "DELETE" });
    console.log(`\nCleanup: DELETE experiment folder ${container.folderId} -> ${del.status || "(no content)"}`);
  } else {
    console.log(`\nLeaving experiment folder ${container.folderId} in place (GDRIVE_CLEANUP=0).`);
    console.log(`  https://drive.google.com/drive/folders/${container.folderId}`);
  }

  console.log("\n==== SUMMARY ====");
  for (const r of results) {
    console.log(`${r.verdict.padEnd(8)} ${r.gate}`);
  }
  const failed = results.filter((r) => r.verdict === "FAIL");
  console.log(failed.length === 0 ? "\nNo gate failed." : `\n${failed.length} gate(s) FAILED -- see detail above.`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("\nSpike aborted:", e);
  process.exit(1);
});

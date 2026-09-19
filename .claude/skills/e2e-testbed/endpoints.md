# Participant endpoints: what they actually return

Everything here is read off the handlers, not off the docs page. Sources:
`functions/src/api-data.ts`, `api-base64.ts`, `api-session-start.ts`,
`api-condition.ts`, `api-messages.ts`, and the rewrites in `firebase.json`.

## Routing

| Path | Cloud Function | Handler |
|---|---|---|
| `POST /api/data` | `apidata` | `apiDataHandler` |
| `POST /api/base64` | `apidata` (dispatched inside it) | `apiBase64Handler` |
| `POST /api/session` | `participantapi` | `apiSessionStartHandler` |
| `POST /api/condition` | `participantapi` | `apiConditionHandler` |

There are no standalone `apisessionstart` / `apicondition` / `apibase64`
functions any more. Every `/api/*` path sits behind Firebase Hosting, which
imposes a **hard 60-second ceiling** regardless of the function's own timeout.

Error bodies are always `{ "error": CODE, "message": "…" }`. Success bodies are
`{ "message": "Success" }`, plus `metadataMessage` when metadata is on.

## `POST /api/data`

Body: `experimentID`, `filename`, `data`, optional `sessionId`.

| Result | Status | `error` |
|---|---|---|
| Stored with the provider | `201` | — (`{"message":"Success"}`) |
| Accepted but queued for retry | `202` | `null`, message "Data received. The upload will be retried automatically." |
| Any of the three fields missing | `400` | `MISSING_PARAMETER` |
| Experiment ID unknown | `400` | `EXPERIMENT_NOT_FOUND` |
| Experiment finalized | `400` | `EXPERIMENT_FINALIZED` |
| "Accept new data" off | `400` | `DATA_COLLECTION_NOT_ACTIVE` |
| Session cap reached | `400` | `SESSION_LIMIT_REACHED` |
| Fails the experiment's validation rules | `400` | `INVALID_DATA` |
| Filename already taken | `400` | `FILE_EXISTS` |
| Owner has no connection for the provider | `400` | `PROVIDER_NOT_CONNECTED` |
| Credential exists but is unusable | `202` | queued; the credential code is logged, not returned |
| Cloud Storage write failed | `500` | `DATA_PERSIST_ERROR` |
| Token resolution threw | `500` | `TOKEN_RESOLUTION_ERROR` |
| Could not even queue | `500` | `UPLOAD_EXCEPTION` |

Gate order matters: `EXPERIMENT_NOT_FOUND` → `EXPERIMENT_FINALIZED` →
`DATA_COLLECTION_NOT_ACTIVE` → `SESSION_LIMIT_REACHED` → `INVALID_DATA`. A
probe only proves the code you expect if every earlier gate passes.

`FILE_EXISTS` and `INVALID_DATA` deliberately leave staged trials alone, so a
streamed session refused for either reason is still recoverable by the sweep.
The four experiment-state gates discard staging instead.

## `POST /api/base64`

Body: `experimentID`, `filename`, `data`. No `sessionId`.

| Result | Status | `error` |
|---|---|---|
| Stored | `201` | — |
| Queued for retry | `202` | `null` |
| A field missing | `400` | `MISSING_PARAMETER` |
| Experiment ID unknown | `400` | `EXPERIMENT_NOT_FOUND` |
| Experiment finalized | `400` | `EXPERIMENT_FINALIZED` |
| **"Accept base64 file uploads" off** | `400` | `BASE64DATA_COLLECTION_NOT_ACTIVE` |
| Not base64 (`is-base64`, MIME prefixes allowed) | `400` | `INVALID_BASE64_DATA` |
| Filename already taken | `400` | `FILE_EXISTS` |

**The active check runs before the validity check.** With base64 uploads
switched off, an invalid payload returns `BASE64DATA_COLLECTION_NOT_ACTIVE`,
not `INVALID_BASE64_DATA` — so the invalid-payload probe proves nothing unless
the switch is on. There is no `SESSION_LIMIT_REACHED` or validation gate on
this endpoint.

## `POST /api/session`

Body: `experimentID`, optional `filename` (advisory: it names a recovered
partial, nothing else).

| Result | Status | Body |
|---|---|---|
| Admitted | `200` | `sessionId`, `databaseURL`, `maxTrialBytes`, `maxTrials`, `flushIntervalMs`, `flushEveryNTrials`, `maxDisconnects` |
| Method is not POST | `405` | `{"error":"Method not allowed"}` |
| Streaming switched off server-side, or RTDB unreachable/unprovisioned | `503` | `SESSION_START_ERROR` |
| `experimentID` missing | `400` | `MISSING_PARAMETER` |
| Unknown / finalized / inactive / at the cap | `400` | same four codes as `/api/data`, in the same order |

Admission does **not** consume a session; the count is taken at submission.
Probing this is harmless: a session that stages no trials is discarded by the
sweep rather than written out as an empty partial.

## `POST /api/condition`

Body: `experimentID`.

| Result | Status | Body |
|---|---|---|
| Assigned | `200` | `{"message":"Success","condition":<0..n-1>}` |
| `experimentID` missing | `400` | `MISSING_PARAMETER` |
| Experiment ID unknown | `400` | `EXPERIMENT_NOT_FOUND` |
| "Assign conditions in sequence" off | `400` | `CONDITION_ASSIGNMENT_NOT_ACTIVE` |
| Transaction failed | `400` | `UNKNOWN_ERROR_GETTING_CONDITION` |

Assignment is sequential, not random: consecutive calls return `0, 1, …, n-1,
0, …`. With `nConditions === 1` it short-circuits to `0` without a
transaction. There is **no** finalized or active gate here — a finalized
experiment still hands out conditions.

## Probes

Paste into the JavaScript tool with a testbed tab focused. Set `EXP` first.

```js
const BASE = "https://datapipe-test.web.app";
const EXP = "PUT_THE_EXPERIMENT_ID_HERE";
const probe = async (path, body) => {
  const r = await fetch(`${BASE}/api/${path}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { path, status: r.status, body: await r.json().catch(() => null) };
};
```

```js
// Expect 201 {"message":"Success"} with base64 uploads ON,
//        400 BASE64DATA_COLLECTION_NOT_ACTIVE with them off.
await probe("base64", { experimentID: EXP, filename: `probe-${Date.now()}.txt`, data: btoa("probe\n") });

// Expect 400 INVALID_BASE64_DATA -- only meaningful with base64 uploads ON.
await probe("base64", { experimentID: EXP, filename: `probe-bad-${Date.now()}.txt`, data: "!!! not base64 !!!" });

// Expect 400 MISSING_PARAMETER.
await probe("base64", { experimentID: EXP, data: btoa("x") });

// Expect 200 {"message":"Success","condition":N} with conditions ON,
//        400 CONDITION_ASSIGNMENT_NOT_ACTIVE with them off.
await probe("condition", { experimentID: EXP });

// Expect 200 with sessionId + databaseURL. Stages nothing, so nothing to clean up.
await probe("session", { experimentID: EXP, filename: "probe-session.csv" });

// Expect 400 MISSING_PARAMETER.
await probe("data", { experimentID: EXP, filename: "no-data.csv" });

// Expect 400 EXPERIMENT_NOT_FOUND from all four.
const ghost = "definitely-not-an-experiment";
await Promise.all([
  probe("data", { experimentID: ghost, filename: "a.csv", data: "a\n" }),
  probe("base64", { experimentID: ghost, filename: "a.txt", data: btoa("a") }),
  probe("session", { experimentID: ghost }),
  probe("condition", { experimentID: ghost }),
]);
```

```js
// Expect 405 {"error":"Method not allowed"} -- the only endpoint that checks.
await fetch(`${BASE}/api/session/`, { method: "GET" }).then((r) => r.status);
```

Every probe that names a real experiment writes to `logs/<experimentID>`, so
the dashboard's error panel will show the deliberate failures. Say so in the
report.

A `MISSING_PARAMETER` refusal returns before any log write, so those probes
leave nothing behind. An `EXPERIMENT_NOT_FOUND` refusal *does* write
`logs/<the bogus id>` with no `owner` field — `firestore.rules` gates reads on
`owner == request.auth.uid`, so nobody can read it and it will not appear on
any dashboard. Use one fixed bogus ID for these probes rather than a random one
per run, so they do not accumulate.

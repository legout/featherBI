# Plan 0002: remote snapshot (`build --remote`)

Status: **approved** by the owner on 2026-11-24, together with spec 0002 revision 2.
Source: [spec 0002 revision 2](../specs/2026-11-24-0002-remote-snapshot.md). The owner approved revision 1 on 2026-11-24 ("approved", commit `3c7c46f`). Revision 2 changes only the upload mechanism (step 3); the owner approved it together with this plan.
Evidence: [spike report](../research/2026-11-24-presigned-range-reads-spike.md). Architecture: [ADR 0001](../adr/0001-dashboard-stack.md), [ADR 0002](../adr/0002-repository-is-the-skill.md). Vocabulary: [CONTEXT.md](../../CONTEXT.md) ("Remote snapshot").
Contract: planning-contract v1. Installed provenance: legout/skills (installed copy, exact revision unknown).
Capture checkpoint (from the spec): "Remote snapshot" is in CONTEXT.md; no new ADR (an output mode within ADR 0001); the open uncertainties are real AWS S3, session-token lifetime and Safari.

## Goal

`build --remote s3://<bucket>/<prefix>` uploads the snapshot tables, embeds expiring presigned GET URLs, and the page downloads each table whole before tiles run. Spec 0002 acceptance 1–6 must hold.

## Constraints for sequencing

- **Prerequisite: T9 (#65)** must merge first. It owns the `--offline`/`--split` flags in `scripts/featherbi.mjs`, the output modes in `scripts/lib/render.mjs`, and the snapshot-loading code in `assets/renderer.js`. This plan extends exactly those places.
- **No new runtime dependency.** Signing, HEAD and PUT use `node:crypto` and the global `fetch` of Node ≥ 22.
- **Upload in Node, not DuckDB.** DuckDB's `COPY … TO 's3://…'` rewrites the Parquet bytes. The object would then no longer match the content hash in its key, and DuckDB has no cheap way to check whether an object exists. So the build sends the bytes it already holds with a signed HEAD, then a PUT only when the HEAD returns `404`. This is spec 0002 revision 2, step 3.
- **Out of scope** (spec non-goals): range reads, partitioning, object cleanup, CI storage services.

## Requirement → task map

| Spec 0002 item | Task |
|---|---|
| Flags `--remote`, `--expires`; rejected combinations | R1 |
| Credentials from the environment; never printed; session-token warning | R1 |
| Content-hash keys, idempotent upload | R1 |
| SigV4 GET presign | R1 |
| CORS preflight before any HTML is written | R1 |
| Size report, 200 MB warning, the 25 MB warning skipped | R1 |
| HTML embeds `{table → url, bytes}` and `expires_at`, no Parquet | R2 |
| Parallel whole-file download with progress, then load as embedded | R2 |
| "Data available until …", expiry and `403` message, per-table failure | R2 |
| Bucket CORS rule and `--remote` usage in the skill reference | R3 |
| Acceptance 1–6 (manual, local SeaweedFS and the owner's) | R4 |

## Tasks

R1 → R2 run in order (they share `render.mjs` and the remote data shape). R3 runs after R2 and after T10 (#66, which writes the skill docs). R4 comes last.

### R1: Remote upload, signing and preflight (build side)

- **Files:**
  - `scripts/lib/s3.mjs` (new): `presign({method, url, expiresSec, now, env})`, `remote(snapshots, target, {expiresSec, env, now})`;
  - `scripts/featherbi.mjs`: the flags;
  - `scripts/lib/render.mjs`: accepts `remote` instead of the embedded snapshot bytes; the HTML for R1 may still be the default page;
  - `tests/remote.test.mjs` (new).
- **Interface produced:**
  - `remote()` returns `{ tables: { <table>: { url, bytes } }, expiresAt: <ISO string> }` or throws an `Error` whose message names the table or bucket and the problem;
  - `render(config, snapshots, filters, { remote })` embeds `remote` in place of `snapshots`.
- **Behavior:**
  - **Flags:**
    - `--remote` + `--offline` or `--split` is rejected;
    - `--expires` accepts `<n>h` or `<n>d` from 1h to 7d, default 7d;
    - `--remote` accepts only an `s3://bucket/prefix` URL.
  - **Credentials:**
    - `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are required; `AWS_SESSION_TOKEN`, `AWS_REGION` (default `us-east-1`) and `AWS_ENDPOINT_URL` are optional;
    - with an endpoint the build uses path-style URLs, otherwise `https://<bucket>.s3.<region>.amazonaws.com`;
    - with a session token it prints the expiry warning from the spec;
    - error messages never contain the credential values.
  - **Upload:** the key is `<prefix>/<sha256 of the Parquet bytes>.parquet`. A signed HEAD is sent first:
    - `200` → skip;
    - `404` → signed PUT;
    - anything else → error naming the status.
  - **Preflight:** a signed GET with `Range: bytes=0-0` and `Origin: null` is sent for every table. It must return `206` with `Access-Control-Allow-Origin` equal to `null` or `*`; otherwise the build fails with the bucket-CORS hint. No HTML is written on failure.
  - **Size:** the build prints the total size of the remote data; above 200 MB it prints the spec's warning. The 25 MB embedded warning (T9) is skipped in remote mode.
- **Validation (high risk: credentials):** `new-test`, node:test. The named failures and their checks:
  - **Wrong signature: a URL that the store rejects.**
    - Oracle: AWS's published SigV4 query-string example ("Authenticating Requests: Using Query Parameters", GET `examplebucket/test.txt`, `AKIAIOSFODNN7EXAMPLE`, `20130524T000000Z`, 86400 s, expected signature `aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404`).
    - Check: `presign` with `now` fixed must reproduce that URL exactly.
  - **Upload: a re-run uploads again, or a failure goes unnoticed.**
    - Check: an in-test `node:http` server that records requests, used as `AWS_ENDPOINT_URL`. First build: HEAD 404 → PUT. Second build: HEAD 200 → no PUT.
    - The PUT body must equal the snapshot bytes. A HEAD `403` must fail the build with no HTML written.
  - **Preflight: a bucket without CORS produces a broken dashboard.** Check: the same server, without the CORS header → the build fails and no output file exists.
  - **Credential leak.** Check: secret and session token values set to unique strings; neither appears in the HTML, stdout, stderr or any error.
  - **Flag errors.** Check: one test for each rejected combination or value.
- **Done:** `node --test tests/remote.test.mjs` is green, and CI is green.

### R2: Remote page (browser side)

- **Files:** `assets/renderer.js` (data loading, banner, messages), `templates/dashboard.html` if the banner needs a slot, `tests/remote.spec.mjs` (new).
- **Interface consumed:** the `remote` block from R1 (`tables`, `expiresAt`).
- **Behavior:**
  - **Before expiry:**
    - the header shows "Data available until <local date and time>";
    - every table is fetched with `fetch` in parallel, with one progress bar ("Loading data <n> / <total> MB"; `bytes` gives the total);
    - each table is passed to the same `engine.open` path as embedded bytes, and the rest stays unchanged (tiles, filters, the URL hash, Explore).
  - **Expired** (viewer clock past `expiresAt`, or any table fetch returns `403`): the page shows the spec's expiry message and runs no tile queries. The layout and the filter bar stay visible.
  - **Other failure** (network, CORS, `404`): a message names the table and the status. Tiles that use that table show the error, and the other tiles render.
- **Validation (normal risk):** `new-test`, Playwright, Chrome and Firefox. The test builds the hand fixture with `--remote` against R1's test server; the fixture server serves the stored Parquet with CORS. The URLs are opaque to the page, so no real signing is needed in the browser test. The named failures:
  - **Remote data not loaded, or loaded differently from embedded.** Oracle: the hand-fixture README values. Check: opened from `file://`, the KPI and pivot values match the README, as in spec 0001 acceptance 1.
  - **The expiry UX breaks.** Check:
    - `expiresAt` in the past → the expiry message shows and no tile query runs;
    - the server answering `403` → the same message;
    - the server answering `404` for one table → a message names that table, and a tile over another table still renders.
- **Done:** green in both browsers, and CI is green.

### R3: Skill reference for `--remote`

- **Files:** `skill/featherbi/references/sources.md` (or the output-modes reference that T10 creates), `SKILL.md` (one line in the workflow).
- **Content:**
  - the flags and their limits;
  - the environment variables;
  - the bucket CORS rule as JSON for S3 and as `weed` config for SeaweedFS (GET from any origin, exposing `Content-Length`/`Content-Range`; `file://` sends `Origin: null`);
  - the bearer-link and expiry caveats;
  - revocation by deleting objects;
  - mode status **unqualified** until R4.
- **Validation (low risk):** `no-new-test`. Diff inspection; the CORS snippet is the one R4 uses, so R4 proves it.
- **Done:** merged.

### R4: Final verification (manual, owner)

- **Journeys** (spec 0002 acceptance 1–6):
  - against a local `weed mini` (the setup in the spike report);
  - against the owner's SeaweedFS;
  - opened from `file://` in Chrome and Firefox.
- **Expected:**
  - **1:** the hand-fixture values; the HTML is under 2 MB.
  - **2:** a second build sends no PUT (check the SeaweedFS access log, or count the objects before and after).
  - **3:** a build with `--expires 1h`, opened after the hour has passed, shows the expiry message.
  - **4:** a bucket without the CORS rule fails the build, and no HTML is written.
  - **5:** `grep` finds none of the credential values in the HTML or the build log.
  - **6:** the flag errors are rejected.
- **Then:** mark the mode qualified for SeaweedFS in the skill reference; real AWS S3 stays unqualified until it is verified.
- **Done:** a report with the observed values per acceptance item, posted on the epic.

## Residual risks

- **Real AWS S3:** untested; R4 qualifies SeaweedFS only.
- **Session-token lifetime:** the build only warns; links can die before `--expires`.
- **Safari and `Origin: null`:** not checked.
- **Engine range reads:** a future engine change could start range-reading; that is out of scope, and the object layout does not block it.

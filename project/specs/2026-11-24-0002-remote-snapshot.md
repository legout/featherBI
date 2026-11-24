# Spec 0002: remote snapshot with presigned URLs

Status: **approved**, revision 1 (owner, 2026-11-24, "approved"). The owner chose option 1 (whole file per table) after the range-read spike.
Builds on: [spec 0001](2026-11-24-0001-featherbi-v1.md) (revision 4). Evidence: [research/2026-11-24-presigned-range-reads-spike.md](../research/2026-11-24-presigned-range-reads-spike.md). SQLRooms does the same for URL sources: it downloads the file whole with progress, then loads it into a table (`@sqlrooms/room-shell` `downloadFile` → `loadFile`, main 1347dd2).

## Goal

A dashboard whose HTML stays small: the snapshot tables live in an S3-compatible bucket (S3, SeaweedFS), and the HTML holds presigned GET URLs that expire. Anyone with the file can open the dashboard until then, from `file://` or a web server, without credentials. After expiry the page says so clearly. A refresh is still a rebuild.

## Flow

1. The author runs `build --remote s3://<bucket>/<prefix> [--expires <duration>]`.
2. **Source phase:** unchanged from spec 0001. It writes the Parquet snapshot tables locally, byte-identical to the embedded mode.
3. **Upload:** the native DuckDB CLI uploads each table to `s3://<bucket>/<prefix>/<sha256>.parquet`, where `<sha256>` is the hash of the file's bytes.
   - An object that already exists under that key is not uploaded again, so a re-run converges on the same state.
   - A rebuild never overwrites the data behind an older dashboard.
4. **Sign:** the build presigns one GET URL per table (AWS SigV4 query signing in `node:crypto`; no SDK, no new dependency).
5. **Preflight:** before writing any HTML, the build sends each signed URL one GET with `Range: bytes=0-0` and `Origin: null`. It stops with an error that names the table and the missing piece unless every response is `206` with `Access-Control-Allow-Origin` matching `null` or `*`. No HTML is written on failure.
6. **Render:** like spec 0001, but the HTML embeds `{table → signed URL, byte size}` and `expires_at` instead of the Parquet bytes.
7. **Open:** the page fetches every table whole, in parallel, with one progress bar ("Loading data 34 / 120 MB"). It loads each table into Haybarn exactly as it loads an embedded snapshot table. From then on, tiles, filters, the URL hash and Explore behave as in spec 0001.

## Interface

| Flag | Rule |
|---|---|
| `--remote s3://<bucket>/<prefix>` | Turns on remote mode. It cannot be combined with `--offline` or `--split`; the build rejects such a combination. All tables are remote; there is no mixing of embedded and remote tables. |
| `--expires <n>h\|<n>d` | Default `7d`. Allowed from `1h` to `7d` (the SigV4 maximum). Anything else is rejected. |

**Credentials** come only from the environment: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optionally `AWS_SESSION_TOKEN`, `AWS_REGION` (default `us-east-1`), and `AWS_ENDPOINT_URL` for SeaweedFS and other non-AWS stores.
- With an endpoint URL, requests use path-style addressing.
- The upload and the signing use the same values, so the two cannot disagree.
- When the build cannot learn the lifetime of a session token, it prints a warning: "links stop working when the session token expires, possibly before `--expires`".
- Credentials never appear in the config, the HTML, logs or error messages.

## Behavior in the browser

- **Before expiry:** the header shows "Data available until <local date and time>".
- **After expiry** (judged by the viewer's clock, or when any data request gets a `403`): the page shows "This dashboard's data link has expired. Ask the author to rebuild it." and runs no queries. The filter bar and the layout stay visible.
- **Any other load failure** (network, CORS, `404`): the page names the table and the HTTP status, and keeps the other tiles that do not need that table.
- **No range reads.** Each table is downloaded once, in full, and lives in memory, as in embedded mode. If a later engine version range-reads reliably, it can switch to views over the same URLs without changing the bucket layout (out of scope here).

## Size

- The build reports the total download size.
- It warns above 200 MB total ("every viewer downloads this on open; aggregate in source SQL").
- The 25 MB embedded-data warning of spec 0001 does not apply in this mode.

## Security

- **Bearer link:** anyone holding the HTML can read the data until expiry, just as anyone holding an embedded file can read it forever.
- **Early revocation:** delete the objects.
- **No listing:** the bucket needs no public access or listing. Each URL grants GET on one object only.
- **Bucket CORS:** the skill's reference documents the CORS rule for S3 and SeaweedFS. It allows GET from any origin, which `file://` needs because it sends `Origin: null`, and exposes `Content-Length`/`Content-Range`.

## Determinism

The objects and their keys are deterministic under spec 0001's preconditions. The HTML is not deterministic, because signatures and `expires_at` depend on the build time. Acceptance 7 of spec 0001 excludes `--remote`.

## Non-goals

- Range reads, partitioned tables, and live Delta/Iceberg/DuckLake in the browser. Iceberg REST with vended credentials would need its own spec.
- Refreshing a dashboard after expiry without a rebuild, re-signing services, or any server.
- Cleanup of old objects (the author deletes them).
- CI acceptance; this mode is accepted manually (owner decision).

## Acceptance examples (manual, local SeaweedFS and the owner's SeaweedFS)

1. **Same answers.** A `--remote` build of spec 0001 fixture 1 shows exactly the values of spec 0001 acceptance 1, opened from `file://` in Chrome and Firefox. The HTML contains no Parquet data and is smaller than 2 MB.
2. **Idempotent upload.** Building twice uploads nothing new the second time (no PUT requests), and both dashboards work.
3. **Expiry.** A build with `--expires 1h`, opened after the hour has passed (simulated by the viewer clock or a URL signed with a past time), shows the expiry message and no console errors from tiles.
4. **CORS preflight.** Against a bucket without CORS, the build stops with an error that names the bucket rule, and no HTML is written.
5. **No secrets.** None of the credential values appears in the HTML or the build output (checked by a search over both).
6. **Flag errors.** `--remote` combined with `--offline` or `--split`, and `--expires 8d`, are rejected.

## Capture checkpoint

- **Vocabulary:** adds **remote snapshot** (snapshot tables stored in a bucket and reached through presigned URLs) to CONTEXT.md on approval.
- **Decisions:** no new ADR. This is an output mode within ADR 0001, which still holds: snapshot at build time, browser never needs credentials.
- **Uncertainty:**
  - the real AWS S3 path is untested (only SeaweedFS);
  - how the build learns a session token's lifetime;
  - whether Safari accepts `Origin: null` CORS.

# Spike: can the browser engine range-read Parquet from presigned URLs?

Date: 2026-11-24. Approved by the owner as the gate before spec 0002 (remote snapshot). Throwaway probe, nothing kept in the repo.

## Question

Does a filtered query in Haybarn-Wasm 2.0.1-rc3 (and upstream duckdb-wasm 1.33.1-dev57.0) over a presigned S3 URL fetch only byte ranges, or the whole file?

## Setup

- SeaweedFS 4.55 `weed mini` locally, S3 on 127.0.0.1, CORS `*`. Bucket `spike`, one Parquet file written by native DuckDB 2.0 `COPY … TO 's3://…'`: 4 M rows, sorted by `region`, `ROW_GROUP_SIZE 100000`, **281.9 MB**.
- GET URL presigned with SigV4 in ~20 lines of `node:crypto` (no SDK). Check: ranged GET → `206`, HEAD → `403` (GET-only signature), tampered key → `403`, `Origin: null` preflight → allowed.
- Probe page: the same engine bundles and worker-blob loading as `renderer.js`, query `SELECT count(*), sum(revenue) … WHERE region='EU'` and then `'US'`, via `CREATE VIEW … read_parquet('<url>')` or `registerFileURL`.
- Playwright 1.65.1, Chromium and Firefox. A counting reverse proxy (and, as control, a plain Node server with HEAD + Range + CORS) logged every request and the bytes sent.

## Results

All runs returned the correct values (EU n = 1,000,348, sum = 499,905,892.10, matching native DuckDB).

| Case | Requests seen by the server | Bytes fetched |
|---|---|---|
| Haybarn, signed, `file://`, Chromium | HEAD 403 ×2, GET `bytes=0-0` 206, then GET `bytes=1-281879280` 206 | 281.9 MB (whole file) |
| Haybarn, signed, `file://`, Firefox | HEAD 403, GET 206 ranges, plus one full GET 200 | 281.9 MB |
| upstream 1.33.1, signed, Chromium / Firefox | same pattern | 281.9 MB |
| Haybarn, **unsigned** control, same-origin `http://`, server answers HEAD 200 + `Accept-Ranges` + `Range`→206 | HEAD 200 ×3, one full GET 200 | 281.9 MB |
| same, Firefox | two full GETs | 563.8 MB |
| upstream 1.33.1, unsigned control | full GET (query took 86 s) | 281.9 MB |
| Haybarn, `registerFileURL(…, directIO=true)`, signed or unsigned | one full GET | 281.9 MB |
| Haybarn, `db.open({filesystem:{reliableHeadRequests:true, allowFullHTTPReads:false}})` | on `file://`: `SecurityError` before any request; on `http://`: "Failed to open file" after one HEAD | — |

Once loaded, the second query took 54–600 ms (the data is in memory); the first took 0.4–2.4 s locally, and up to 86 s for upstream on one run.

## Verdict

- **No range reads in this setup, with or without a signature.** Both engines read the whole Parquet file on first access, and Firefox sometimes twice. The worker bundle has range logic (`HEAD` with `Range: bytes=0-`, then a 1-byte probe), but in every configuration I tried it fell back to a full read. The presigned case fails the same way as the unsigned control, so the bug is not specific to signatures; it matches duckdb-wasm #2228 and #1367.
- **What does work:** presigned GET URLs, CORS from `file://` (`Origin: null`), correct results, and the SigV4 signing without a dependency.
- **Not isolated (time box):** whether some other combination of filesystem flags gets range reads, and why `reliableHeadRequests` fails to open the file even though the server answers a ranged HEAD with 206. One more step would be a minimal repro for the upstream issue.

## Consequence for spec 0002

The owner chose "signed URLs + range reads". On today's engines that degrades to **signed URLs, whole file per table on first use**. Options:

1. Ship whole-file download now (load each table into memory once, like the embedded snapshot). Range reads become a later engine upgrade with no format change, because the objects and URLs stay the same.
2. Split large tables into several Parquet files at build time (for example by the date dimension), so a filter loads only the parts it needs. That costs one signed URL per part and is more build logic.
3. Wait for an engine fix before spec 0002.

## Cleanup

SeaweedFS and the helper servers were stopped. Files are in `/tmp/spike-presign` and `/tmp/spike-tools`, outside the repo.

# Static sharing, live refresh, and source export

**Status:** approved revision 1, 2026-10-19. Owner approved the specification, [plan 0005](../plans/2026-10-19-0005-static-sharing-and-live-refresh.md), and [plan 0006](../plans/2026-10-19-0006-simplification-and-standard-theme.md) in chat on 2026-10-19, including Refresh for single-file live sources. Decisions: [ADR 0010](../adr/0010-owner-simplification-decisions.md).

> **Owner clarifications during ticket #41 (2026-10-19):** Delta export accepts local or native-readable remote table locations; S3 uses the existing author credential chain and gitignored `.env` conventions, with no new auth flags. A published Parquet-set manifest may use a public HTTPS URI as well as S3; the existing selector must support that URI.
> **Owner clarifications during ticket #43 (2026-10-19):** the static CSP lists exact origins only; S3-backed live sources need `region` or `endpoint` and Iceberg REST-catalog sources need `remote.endpoint`, so every `connect-src` origin is derivable at build time (§7).

## 1. Purpose and authority

This specification defines the primary sharing path (a statically hosted `dashboard.html` reading live sources), refresh for every live source, the Delta source-export path, the DuckLake gate, and the ZIP fallback. It amends, and does not replace:

- [dashboard v2 §11](dashboard-project-and-runtime-v2.md) (packaging becomes the fallback path);
- [remote sources v1 §4–§5](remote-sources-v1.md) (delivery defaults, refresh);
- [live Parquet sets and Iceberg](2026-09-28-0004-live-parquet-sets-and-iceberg-tables.md) (Delta is read through export only).

Rationale: ADR 0010, with amendments to ADR 0005, 0007, and 0009.

## 2. Build targets

- `featherbi build --target static` writes exactly one file, `dashboard.html`. It contains no dataset bytes, credentials, or absolute paths.
- `featherbi build --target zip` writes the ZIP bundle for local and packaged sources. Its behavior is unchanged.
- `--target` is required. The skill proposes `static` when every source is live and `zip` otherwise.
- The static target accepts only live sources. A local file or a `delivery: packaged` source fails the build. The error names the source and the remedy: declare `delivery: live` with a public `https://` URI, or use the zip target.

## 3. Live sources and refresh

- Live sources are CSV, JSON, and Parquet files (`delivery: live`, `https://` or `s3://` with session credentials), Parquet file sets (glob or manifest), and Iceberg tables (metadata URI or REST catalog). DuckLake is live only after the gate in §5.
- Every live source has a **Refresh** control. Refresh re-resolves the source's identity (Parquet-set membership, manifest, Iceberg snapshot or catalog metadata), or re-reads the URI of a single file. The new generation is staged and replaces the active one only when staging succeeds.
- When a refresh fails, the previous results stay visible with a source-specific error. This is the existing rule.
- There is no automatic polling and no background refresh. Filter changes never trigger a refresh, because generations are pinned.

## 4. Delta source export

- Browser reads of Delta tables are out of scope ([ADR 0009](../adr/0009-browser-only-lakehouse-readers.md), [ADR 0010](../adr/0010-owner-simplification-decisions.md)).
- `featherbi export delta --input <table location> --output <directory>` runs on the author's machine with native DuckDB and the Delta extension. The input may be local or a remote location readable by native DuckDB; S3 credentials follow the existing author credential chain and gitignored `.env` conventions. Output is local: the Delta snapshot as immutable Parquet part files `<export-id>/part-NNN.parquet`, plus a root `manifest.json` `{"files": [...]}`, plus an `export.json` sidecar with the exact Delta version and export time.
- A new export writes new immutable part files. It overwrites only `manifest.json` and `export.json`.
- featherBI does not upload. The author publishes the output directory at a public `https://` location.
- The project declares the table as a live Parquet set with `selector: {manifest: https://…/manifest.json}`. Refresh re-fetches the manifest.
- Freshness equals the export cadence. The recipient sees new data after Refresh.

## 5. DuckLake gate

- DuckLake is read live only after spike S2 in [plan 0005](../plans/2026-10-19-0005-static-sharing-and-live-refresh.md) passes. The gate requires: the pinned DuckDB v1.5.5 `wasm_eh` extension artifact (exact URL recorded in the capability manifest), a public catalog attached over `https://`, and one table read in desktop Chrome.
- The owner approved the exact DuckDB v1.5.5 `wasm_eh` DuckLake extension URL and SHA-256 after S2; see [ADR 0009](../adr/0009-browser-only-lakehouse-readers.md). A different URL or hash requires a new trust decision.
- If S2 fails, DuckLake stays out of the live scope. Authors export DuckLake tables with the same export mechanism as Delta, using native DuckDB.

## 6. ZIP fallback

The ZIP path keeps its current rules: local and packaged sources, explicit file selection, and no dataset bytes in HTML ([ADR 0005](../adr/0005-external-data-only-delivery.md), as amended). Embedded base64 data stays rejected.

## 7. Trust, hosting, and CSP

- Recipient credentials (S3 secret, Iceberg bearer token) stay memory-only. Nothing is persisted.
- The static HTML contains no credentials, paths, or dataset bytes. The build verifies this.
- Cross-origin live reads require the data host to allow CORS for the static page's origin. Same-origin reads need no CORS. A CORS failure shows the visible error with the remedy "host the data on the same origin or allow CORS". The packaged-delivery remedy applies only to the zip target.
- Content-Security-Policy: the existing specifications refer to an artifact CSP. The generated test HTML contains none (checked in `build/` and `.artifacts/browser/`). The static target emits a CSP whose `connect-src` lists the declared live origins and the pinned DuckDB-WASM asset origins. Spike S1 verifies that the policy does not block legitimate reads or extension loads.
- Owner decision (2026-10-19, ticket #43): the static CSP lists exact origins only — no wildcards. Every origin must be derivable at build time: from the declared HTTP(S) URL, the configured S3 `endpoint` (the runtime reads it path-style), or the declared bucket plus `region` (regional AWS endpoints). The static target therefore rejects an S3-backed source with neither `remote.region` nor `remote.endpoint`, and rejects an Iceberg REST-catalog source without `remote.endpoint`, because the catalog supplies the storage bucket at open time (`remote.catalog.endpoint` is not a substitute). Both failures name the source and the zip-target alternative; the zip target keeps accepting every live shape.
- Hosting, upload, DNS, and access control are outside this specification. Source-system access controls do not follow published data.

## 8. Acceptance

- **SL-01** A static build with a local or packaged source fails, naming the source and the remedy. The zip build is unchanged.
- **SL-02** A static build writes only `dashboard.html`, with no dataset bytes, credentials, or absolute paths.
- **SL-03** For each live kind, Refresh re-resolves or re-reads the source. After a failed refresh the previous results stay visible with a source-specific error.
- **SL-04** CSV, JSON, and Parquet-file live sources load from a static test origin without file selection.
- **SL-05** A Delta fixture with an update and a delete exports with row counts equal to native `delta_scan`. The manifest loads through the existing manifest selector in the browser.
- **SL-06** DuckLake appears only if S2 passes. If it passes, the table reads live in Chrome. Otherwise DuckLake is absent from the release.
- **SL-07** The static page reads a cross-origin public source where CORS allows it, and shows the CORS remedy where it does not.
- **SL-08** Owner acceptance on real data: the owner's dataset is published at a URL the owner controls, the static page opens from that host without file selection, and the AP baseline (AP-01–AP-07) matches.

## 9. Non-goals

Automatic polling or background refresh; featherBI uploading or publishing data; browser reads of Delta tables; OAuth or catalog-vended credentials; server-side read services; Iceberg writes; hosting infrastructure.

## 10. Open items

None.

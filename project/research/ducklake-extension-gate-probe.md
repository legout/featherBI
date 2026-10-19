# DuckLake extension gate probe (ticket #38 / S2)

**Status:** evidence collected 2026-10-19 in desktop Chrome. Disposable spike per [plan 0005](../plans/2026-10-19-0005-static-sharing-and-live-refresh.md) S2 and [spec 0005 §5](../specs/2026-10-19-0005-static-sharing-and-live-refresh.md). No product code changed; the harness lived outside the repository and was disposed after evidence extraction. **All gate steps passed.**

## Question

Does DuckLake pass the live-reading gate for the pinned browser runtime: does the official DuckDB extension repository serve a `ducklake` WASM artifact for the pinned engine version/platform, does it load in the pinned `@duckdb/duckdb-wasm`, and can a public DuckLake catalog be attached over `https://` and read in desktop Chrome without credentials? The artifact URL and SHA-256 are recorded here for owner trust gate G3, following the [ADR 0009](../adr/0009-browser-only-lakehouse-readers.md) Iceberg precedent.

## Environment

- Desktop Chrome 155.0.8059.80 (macOS), driven over the DevTools protocol with a fresh temporary profile.
- `@duckdb/duckdb-wasm@1.33.1-dev64.0` — the version pinned in `package.json`, taken from the repo's already-installed `node_modules` (nothing installed during the spike), served from a local static origin `http://127.0.0.1:8899`. EH bundle; engine reports DuckDB `v1.5.5`, platform `wasm_eh` — same pinned runtime as [S1](static-hosting-cors-csp-probe.md).
- Console and network evidence captured over CDP; one clean run plus a confirmation re-run, identical results.

## Gate evidence

1. **Artifact exists at the official endpoint.** `https://extensions.duckdb.org/v1.5.5/wasm_eh/ducklake.duckdb_extension.wasm` → HTTP 200, `content-type: application/wasm`, `access-control-allow-origin: *`, 2,367,417 bytes, a valid WebAssembly module. This supersedes the 2026-09-28 observation that DuckLake was absent from the DuckDB-WASM extension listings.
2. **Artifact hash (for G3).** SHA-256 `154f2504ac3e92de146e5193012ac898ce97f62d5b4701f534176d49aae5594a` — identical from `curl` and from an in-page `crypto.subtle` digest of the bytes the browser actually fetched (the artifact-hash step asserts the match at runtime).
3. **Loads in the pinned runtime.** `INSTALL 'ducklake'` from the default official repository (the WASM build ignores `custom_extension_repository`, per ADR 0009): CDP network capture shows the browser fetching exactly the URL above with status 200. `LOAD 'ducklake'` then reports `duckdb_extensions()` `loaded = true`. No other extension artifact is needed: the SQLite catalog is handled inside the ducklake WASM build (no `sqlite` wasm artifact exists at this endpoint and none was required).
4. **Public catalog attaches over HTTPS.** `ATTACH 'ducklake:https://raw.githubusercontent.com/marhar/frozen/main/space.ducklake'` — the public example catalog from the official DuckLake "Frozen DuckLakes" announcement; unauthenticated, `access-control-allow-origin: *`, catalog ~4.99 MB. No credentials, secrets, or private endpoints were used anywhere.
5. **One table read.** The catalog exposes four tables (`astronauts`, `mission_crew`, `missions`, `spacecraft`); `SELECT count(*) FROM space.astronauts` → 85, with correct sample rows (Parquet data files fetched from the same public origin).

## Result

- **S2 passes**: every required step succeeded, twice. DuckLake remains a candidate for live scope; T5 (#44) is not cancelled by this gate. The remaining blocker for #44 is G3 only: the owner's trust decision on the artifact URL + SHA-256 above.
- This note records technical evidence only. It makes no trust or authorization claim about the extension artifact, the repository, or the example catalog; the example dataset is a third-party demo referenced by official DuckLake documentation, and production dashboards would attach author-chosen catalogs. G3 is the owner's decision.

## Notes for T4/T5 implementers

- The extension load follows the S1 CSP shape already requiring `https://extensions.duckdb.org` in `connect-src`; no additional origin is needed for ducklake itself.
- The `ducklake:` catalog URL scheme is the documented form for remote catalogs (`ducklake:https://…`), not a bare `ATTACH … (TYPE DUCKLAKE)` path.
- Historical absence in the WASM extension listings (noted 2026-09-28) no longer holds; the artifact is served directly even though `extensions.json` listing requests 404 at this path.

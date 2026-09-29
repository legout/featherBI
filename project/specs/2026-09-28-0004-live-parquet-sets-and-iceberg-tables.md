# Live Parquet file sets and Iceberg tables

**Status:** approved revision 1. The owner approved the design and then reviewed and approved this written specification in chat on 2026-09-28. Approved scope: live, unbundled Parquet file sets (glob and manifest), live Iceberg tables (REST catalog and metadata URI), per-load pinning and explicit refresh, memory-only recipient credentials, and deferral of true Delta Lake support. Specification approval does not authorize implementation.

**Authority:** extends [remote sources v1](remote-sources-v1.md) for these new source kinds; preserves [dashboard project and runtime v2](dashboard-project-and-runtime-v2.md), [ADR 0003](../adr/0003-single-worker-source-generations.md), and [ADR 0007](../adr/0007-remote-sources-and-recipient-credentials.md) for existing sources. [ADR 0009](../adr/0009-browser-only-lakehouse-readers.md) records the browser-only boundary; [CONTEXT.md](../../CONTEXT.md) owns vocabulary.

## 1. Scope and boundary

A Parquet file set is several S3 Parquet objects selected as one logical source. An Iceberg table is one logical source resolved using Iceberg metadata, including its snapshot and deletion semantics. Neither is the existing *Dataset*, which is the dashboard's combined source assignments. Both new kinds are read-only and **live-only**: no source data, file inventory, table metadata, catalog token, or storage credentials are bundled into the ZIP. Non-secret declarations and the pinned capability assets may be in the viewer; the runtime fetches source metadata/data when opened. Existing single-file `csv`, `parquet`, and `json` declarations and their packaged-default delivery remain unchanged.

There is no Delta Lake source kind in this revision. Reading its physical Parquet files, or a separately exported Parquet snapshot, must not be presented as a Delta table read. True live Delta support waits for a compatible browser reader proven with the supported DuckDB-WASM build; there is no server, bundled fallback, or implicit format conversion.

## 2. Source declarations

New remote variants have `kind: parquet-set` or `kind: iceberg`, `auth: none|s3` for the underlying S3 objects, optional non-secret `region` and `endpoint` (as for existing S3 sources), `delivery: live`, and the ordinary source ID and declared column schema. `delivery` is required and may only be `live` for these variants. Exactly one selector is required; unknown fields, other URI schemes, and invalid combinations are compile errors naming the source and field. Existing `remote: {uri, format, auth, delivery?, region?, endpoint?}` is not reinterpreted.

### 2.1 Parquet file set

```yaml
sources:
  - id: sales
    schema:
      amount: {type: number, nullable: true}
    remote:
      kind: parquet-set
      uri: s3://reports/sales/
      selector: {glob: "year=*/part-*.parquet"}
      auth: s3
      region: eu-central-1
      delivery: live
```

`uri` is an S3 prefix; a glob is a relative Parquet-object pattern underneath it. The alternative `selector: {manifest: "s3://reports/sales/manifest.json"}` points to a remotely fetched JSON document of shape `{"files": ["year=2026/part-1.parquet", "year=2026/part-2.parquet"]}`. Manifest entries are relative Parquet object keys below the declared prefix, never arbitrary URLs, credentials, or embedded data. Identical keys are deduplicated; distinct keys remain case-sensitive. They resolve to an explicit file list when the generation opens. Reject empty sets, traversal, out-of-prefix keys, non-Parquet entries, unreadable manifests, more than 10,000 selected files, or a manifest larger than 2 MiB with an actionable source error. The file and manifest limits may be revised only with new browser evidence and owner approval.

A glob requires listing and reading permission on the relevant bucket/prefix; its membership is resolved once per generation. A manifest is a mutable pointer to a list, not itself a transaction protocol. Producers should publish immutable object keys; changing an object's bytes in place can defeat per-load consistency even if membership was pinned. Neither selector interprets Delta or Iceberg table metadata. Use the declared column schema for all selected files; incompatible files or columns fail visibly rather than silently unioning or dropping them. Hive partition columns and schema reconciliation beyond the declared common schema are out of scope.

### 2.2 Iceberg table

```yaml
sources:
  - id: orders
    schema:
      amount: {type: number, nullable: true}
    remote:
      kind: iceberg
      catalog:
        endpoint: https://catalog.example.com
        warehouse: analytics
        namespace: sales
        table: orders
      catalogAuth: bearer
      auth: s3
      region: eu-central-1
      delivery: live
```

The alternative is `metadataUri: s3://reports/orders/metadata/v3.metadata.json` instead of `catalog`. A declaration has exactly one of `catalog` and `metadataUri`. `catalogAuth: none|bearer` is required only for a catalog; catalog endpoints must be HTTPS. Storage `auth` is independent of catalog authentication: public objects use `none`, private objects use the existing S3 prompt. Initial support does not assume catalog-vended credentials, browser OAuth, or arbitrary custom headers.

At open/refresh, a catalog identity resolves the current Iceberg snapshot and pins that snapshot ID in the source generation, including delete-file semantics. A metadata URI identifies the exact metadata document; it remains on that document after Refresh unless the authored URI changes. Never scan Iceberg data files as raw Parquet to substitute for unsupported metadata/deletes. The private catalog's recipient-supplied bearer token becomes a temporary in-memory Iceberg secret distinct from the temporary S3 secret. The token is entered for its named HTTPS endpoint and is not stored in browser storage, config, HTML, ZIPs, or logs. Authoring obtains catalog tokens from the environment or a gitignored `.env`, never portable project files or generated reports; existing AWS credential-chain/`.env` behavior applies to storage credentials.

## 3. Runtime lifecycle and SQL boundary

The compiler builds only pinned, trusted source capabilities. It does not accept project-supplied extensions or SQL reader expressions. Trusted runtime code loads the necessary compatible Iceberg capability and creates a schema-scoped logical view named after each declared source ID; all model, dashboard, and playground SQL continues to reference logical IDs only. Existing bans on user SQL file readers, external URLs, extension commands, mutation, and exports remain in force. An Iceberg extension asset must be version-pinned and included in the capability manifest; a remote extension fetch is allowed only from the product's pinned trusted asset location, not from dashboard declarations.

The single DuckDB-WASM worker stages a candidate generation. It resolves each glob or manifest once and each Iceberg snapshot once, then creates views against those resolved inputs. Filter changes and component queries use the active generation, not a freshly selected snapshot/file list. On explicit Refresh or reopen, resolve anew and stage a candidate; validate declared columns and access before atomically publishing sources, filter defaults, and results. Failure retains the previous active generation and results with a visible source-specific error; on initial open, failure is a visible boot error, not a fabricated empty dataset. Candidate credentials and temporary secrets must not overwrite the active generation's secrets while it remains readable. Retire superseded resources and secrets only after successful publication or candidate cleanup. No automatic refresh or background polling.

Opening a very large file set must not silently materialize all rows in JavaScript or force an unbounded full-data scan merely to discover files. Metadata/schema validation and the current runtime's full-input/nullability checks need a measured feasibility decision before implementation: if full checks are necessary but make the supported browser case unusable, return to the owner to approve a changed validation guarantee rather than weakening it implicitly.

## 4. Security, delivery, and failures

The viewer remains a `file://` desktop-Chrome artifact with browser network/CORS requirements. Catalog, metadata, manifest, S3 listing, and object endpoints must support browser requests from the viewer's origin; private catalog access and private storage may each prompt once per session on first need and again after reload. Authentication failure re-prompts once with the failing endpoint/source identified; repeated failure, CORS denial, unavailable metadata/files, expired credentials, schema drift, unsupported extension, or missing snapshot fails visibly. Credentials must not appear in error details or telemetry. The recipient grants only read permissions; no remote writes, catalogs mutations, presigned-URL service, or secrets persisted beyond the engine session.

Configure the catalog bearer token for the declared HTTPS catalog endpoint and S3 keys for the declared object-storage location/endpoint; a browser probe must verify neither secret is forwarded by redirects or reader behavior to another authority. Manifest contents cannot redirect either credential to another authority. Display the named endpoint before credential entry. For these live-only kinds, CORS failures suggest fixing endpoint/browser access, not packaged delivery. Generated preview, compiled config, package manifest, and ZIP may reveal only the already-declared non-secret catalog and storage locations; they never embed the enumerated file list or a credential.

## 5. Authoring, migration, and capability gate

The authoring profiler can inspect a bounded sample/metadata for each new kind with native DuckDB and authorized credentials, without putting raw rows, credentials, enumerated private object paths, or unbounded values in portable reports. A failed resolution must identify the source and useful remedy. Builds reject unsupported variants before publication; existing single-file remote projects compile and behave exactly as before. The authoring skill documents source vocabulary, both selector pairs, credential setup, CORS/listing requirements, immutable-object limitation, and the difference between a table and a Parquet export.

Before committing to implementation, prove with the project's pinned `@duckdb/duckdb-wasm` (`1.33.1-dev64.0`) under supported `file://` Chrome that the compatible Iceberg extension loads from trusted pinned assets, both Iceberg identities can pin/read a snapshot with deletes, a recipient bearer token and separate private S3 credentials work, and globs can be expanded to a stable explicit list and manifests fetched with CORS. Prove both private AWS S3 and one S3-compatible endpoint only where credentials/permissions allow; do not require access to a user's production tables. A negative result blocks the affected variant and returns to design approval; it does not silently switch to a server, package data, or drop snapshot semantics.

## 6. Observable acceptance examples

- **LT-01 — Compatibility:** a previously valid packaged or live single-file source builds and opens unchanged. An unknown new kind, `delivery: packaged`, or both selectors fails compilation naming the source and conflicting fields.
- **LT-02 — Parquet glob:** a live S3 glob resolves several immutable files into one source; filtering does not see a newly added file until explicit Refresh or reopen. Missing ListBucket permission or CORS yields an actionable error rather than empty results.
- **LT-03 — Parquet manifest:** a remote JSON manifest resolves relative keys under the declared prefix; traversal, out-of-prefix keys, and invalid entries are rejected, while exact duplicates are deduplicated before a view is published. A changed manifest appears only in a new generation.
- **LT-04 — Iceberg REST:** a browser-reachable private catalog and private S3 store use separate memory-only prompts. After a new commit, current filters retain the pinned snapshot (including deletes); Refresh uses the new snapshot and updates results coherently. Reload asks for credentials again.
- **LT-05 — Iceberg metadata URI:** one declared versioned metadata JSON is read with Iceberg semantics. Refresh does not pretend it points to newer metadata; changing the authored URI selects a different snapshot.
- **LT-06 — Rollback:** an expired token, missing object, unsupported Iceberg capability, or schema mismatch during refresh leaves the prior active results usable, shows a source-specific error, and never publishes a partly refreshed dashboard.
- **LT-07 — Trust and packaging:** the ZIP contains no remote bytes, enumerated file inventory, or credentials; project SQL cannot invoke `read_parquet`, `iceberg_scan`, `ATTACH`, `LOAD`, or fetch arbitrary URLs. Trusted runtime source setup can use its pinned capabilities.
- **LT-08 — Delta honesty:** a Delta table URI is rejected as a table declaration, and its data files cannot be relabeled as Delta support. A separately exported Parquet set is labeled as Parquet.

## 7. Non-goals and handoff

No Delta Lake table reader, server-side reader/proxy, catalog-vended credentials, OAuth login, automatic refresh, direct catalog writes, Hive/partition inference, schema-union magic, arbitrary URI schemes, or bundled table materialization. These are not fallbacks if a feasibility gate fails.

**Capture checkpoint (planning-contract v1; installed skill provenance unknown):** vocabulary = *Parquet file set* and *remote table source* in `CONTEXT.md`, without overloading *Dataset*; decision = browser-only reader/no Delta facade recorded in ADR 0009; behavior = this approved revision 1 and its LT-01–LT-08 criteria; uncertainty = pinned browser extension, source pinning, S3 listing/CORS and large-source validation require feasibility evidence before implementation readiness. Plan the feasibility gate first; this spec alone does not dispatch implementers or authorize publication.

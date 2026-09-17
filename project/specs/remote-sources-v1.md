# featherBI remote sources specification v1

Status: owner-approved design captured in the 2026-09-17 shaping session (full-design approval); written-review gate pending.

## 1. Purpose and authority

This specification defines read-only remote data sources for featherBI: how authors declare them, how authoring obtains credentials, how they are delivered to recipients, and how the viewer reads them live. It implements the owner's 2026-09-17 decisions: public and private remote support as a near-term requirement, packaged-default delivery, and memory-only recipient credentials.

Sources and rationale:

- [ADR 0007: remote sources and recipient credentials](../adr/0007-remote-sources-and-recipient-credentials.md)
- [Dashboard project and runtime contract v2](dashboard-project-and-runtime-v2.md), whose remote non-goal this specification supersedes
- [AP inspection dashboard](ap-inspection-dashboard.md), which remains the reference local-data scenario
- [CONTEXT.md](../../CONTEXT.md), which owns vocabulary

## 2. Source declaration

- A `dashboard.yaml` source entry may declare a remote source with `uri`, `format`, `auth` (`none` or `s3`), and optional non-secret `region` and `endpoint`.
- Supported URI schemes: `s3://` (any S3-compatible endpoint) and `https://`.
- `auth: none` means public read; `auth: s3` requires key id, secret, and optional session token from the recipient.
- Credentials never appear in project files, portable reports, generated configs, HTML, ZIPs, or logs. Absolute or secret-bearing author state lives only in ignored `.featherbi/` state and the gitignored `.env`.
- Local and remote sources may be mixed in one project; source identity remains the logical source ID.

## 3. Authoring credentials and profiling

- Credential resolution order: AWS credential chain (environment, profiles, SSO), then a gitignored `.env` created from a distributed `.env.example` naming each required secret (key id, secret, optional session token) plus optional region/endpoint.
- Missing credentials produce an actionable error naming the source and the required secret; profiling never fabricates a schema.
- The profiler reads remote URIs through native DuckDB `httpfs` with temporary secrets. Profile output is unchanged in shape and bounds: keyed by source ID, bounded columns/rows statistics, no URIs, no credentials, no raw values without explicit permission.

## 4. Delivery modes

- `packaged` (default): the packager materializes the remote source at build time via native DuckDB `httpfs` into the ZIP as an ordinary data file. The runtime config and HTML carry no remote metadata; the recipient selects files exactly as for local sources. Materialization failure fails the build atomically with the source named; no partial ZIP is published.
- `live`: the compiled runtime config carries `{uri, format, auth, region?, endpoint?}` for the source; the viewer reads it at open time.

## 5. Viewer live reads and the credential boundary

- Public (`auth: none`) live sources are read directly on first use.
- Private (`auth: s3`) live sources prompt the recipient once per session on first need: key id, secret, optional session token. The submitted values create a temporary in-memory DuckDB-WASM secret for that engine session only. Nothing is persisted to browser storage, config, or artifacts; a reloaded dashboard prompts again. Region/endpoint come from author configuration, not the form.
- Authentication failure re-prompts once with the error visible; repeated failure leaves the dashboard in a visible error state rather than a blank or silently stale view.

## 6. Failure behavior

- Authoring: unreachable URI, CORS-rejecting endpoint, missing credentials, or unsupported format produce an actionable error naming the source, the failed operation, and the remedy (credential setup or packaged delivery).
- Viewer live reads: CORS-blocked responses suggest packaged delivery; HTTP 403 or expired session tokens re-prompt for credentials; network unavailability uses the visible boot-error affordance. Remote reads never degrade into guessed schemas or empty results presented as valid.

## 7. Acceptance

- RS-01: Authoring profiles one `s3://`-style and one `https://` source bounded, with no URI or credential in profile output.
- RS-02: A packaged remote build produces a standard ZIP; the recipient flow is identical to local sources and the artifact contains no remote metadata.
- RS-03: A public live source opens in desktop Chrome over `file://` against a served test fixture.
- RS-04: A private live source prompts once per session, holds credentials memory-only, and prompts again after reload.
- RS-05: A CORS-blocked live source shows the actionable packaged-mode error.
- RS-06: Owner-run manual acceptance reads one real private bucket without committing data, paths, or credentials.

## 8. Non-goals

Remote writes or deletes; presigned-URL issuing infrastructure; connectors beyond S3-compatible and HTTPS (JDBC, operational databases); credential persistence in any storage; offline remote reads; browsers beyond desktop Chrome; and exhaustive provider matrices beyond AWS S3, one S3-compatible endpoint, and plain HTTPS.

---
status: accepted
---

# Support remote sources with packaged-default delivery and recipient-owned credentials

featherBI sources may be declared remote: read-only `s3://` (S3-compatible) or `https://` URIs. Each remote source has a delivery mode: `packaged` (default) materializes the data at build time through native DuckDB `httpfs` into the standard external-data ZIP, keeping the recipient flow unchanged; `live` reads the URI at open time in the browser engine. Private live sources prompt the recipient for credentials (key id, secret, optional session token) and hold them only as a temporary in-memory DuckDB-WASM secret for that session — never in browser storage or any persisted artifact. Authoring resolves credentials through the AWS credential chain first, with a gitignored `.env` fallback created from a distributed `.env.example`; non-secret region and endpoint values are author configuration.

This records the owner's 2026-09-17 decision that public and private remote support is a near-term requirement, and supersedes the runtime v2 non-goal on remote sources. Remote writes, presigned-URL issuing infrastructure, and non-S3/HTTPS connectors remain out of scope. Behavior and acceptance are owned by the [remote sources specification](../specs/remote-sources-v1.md); vocabulary lives in [CONTEXT.md](../../CONTEXT.md).

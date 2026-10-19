---
status: accepted
---

# Keep dashboard data outside HTML

> **Amended 2026-10-19 by [ADR 0010](0010-owner-simplification-decisions.md):** static hosting with public live sources is the primary sharing path. The ZIP bundle with explicit file selection remains the fallback for local and packaged data. The rule that dataset bytes never enter HTML still holds, and embedded base64 data stays rejected.

The first release produces only an HTML-plus-data ZIP bundle. The recipient extracts it, opens `dashboard.html` through `file://` in desktop Chrome, and explicitly selects the accompanying local data files. DuckDB-WASM reads those selected files directly; dataset bytes are never Base64-encoded into the HTML.

This supersedes the embedded-HTML option in [ADR 0001](0001-portable-browser-delivery.md). It avoids very large HTML artifacts, duplicated data encoding, and validation/runtime costs that grow with an encoded copy of the dataset. Automatic sibling-file access is not claimed because `file://` browser security requires an explicit user grant. A local server is not required.

Remote URLs, including public CORS-enabled object storage, are deferred. No packaging action implicitly authorizes publication, and source-system access controls do not accompany shared data files.

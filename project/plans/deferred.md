# Deferred hardening backlog

Optional work outside the MVP acceptance path. These items do not relax behavior required by the active specifications; pull one back only for a concrete failure, measured risk, or expanded support claim.

- Broader CSV/JSON conversion matrices beyond the focused representative and late-row failures used by MVP acceptance.
- Automatic repair of duplicate or case-colliding headers; MVP rejects them.
- Additional malformed-Base64, prototype-key, quoted-Unicode, and hostile-string fuzz cases beyond boundary validation and the focused packaging regression.
- Repeated replacement/resource-release stress runs and browser memory accounting beyond one rollback/corrected-replacement acceptance flow.
- Additional SQL AST/admission combinations beyond the supported SELECT/CTE/join, parameter, undeclared-source, file-reader, and multi-statement boundaries.
- More option-search/page and chart top-N reconciliation cases beyond the AP end-to-end flow.
- Automated private 5.4M-row AP regression harness, screenshots, and timing history; MVP uses an explicit owner-run acceptance check without committing private data.
- Accessibility audit beyond semantic labels, keyboard operation, visible focus, and non-color-only status/error basics.
- Edge, offline assets, remote connectors (including public CORS-enabled S3/GitHub URLs), viewer-side editing/re-export, deployment, and publication.

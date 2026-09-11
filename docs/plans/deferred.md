# Deferred hardening backlog

Pulled out of the archived per-phase plans. One line each. Do not implement unless the owner pulls an item back.

- CSV/JSON edge matrices: timestamp microseconds/offsets, unsafe integers, nested JSON values, malformed final rows beyond the reader sample.
- Case-colliding / duplicate header *repair* strategies (rejection is enough for MVP).
- JSON Schema Base64 padding grammar for embedded content (validator currently accepts some malformed Base64 that `atob` rejects).
- Prototype-pollution / `__proto__` / quoted-unicode column-name hardening tests.
- Full-file column-by-column validation scan (MVP validates structure and casts declared columns only).
- Generation staging with concurrent candidate schemas + resource-release cycle-count regression (P2.3's 20-cycle requirement).
- Query admission depth: CTE-scope, modifier sets, `named_param_map` reorder matrices (statement-count + SELECT-node check is the MVP gate).
- Option-search paging (100/page) and selected-off-page-value display.
- Chart top-N + "Other" reconciliation edge tests; heatmap component.
- Source-transition annotation (2023-11-22) and snapshot-end label machinery.
- Private 5.4M-row AP acceptance harness (`test:ap`, memory/timing accounting, screenshots).
- Packaging: hostile-string matrix beyond the single `</script>` case; credential/File-handle leak scan automation.
- Accessibility pass beyond labels/keyboard basics.

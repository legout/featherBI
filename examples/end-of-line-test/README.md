# End-of-line test

10 000 units tested once each, 30 s apart: `tests.parquet` (`tested_at`, `serial`, `station`, `result`,
`fail_code`, `meas_mv`, `lsl`, `usl`). Playbook: `skill/featherbi/references/domains/end-of-line-test.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 9 999): `station = ST(i mod 4 + 1)`; `result = FAIL` when `i mod 25 = 0`, else `PASS`;
for a failure, `j = i div 25` and `fail_code = F01` if `j mod 4` is 0 or 1, `F02` if 2, `F03` if 3;
`meas_mv = 4800 + 10 · (i mod 50)` (4 800 … 5 290), `lsl = 4850`, `usl = 5250`.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Units tested | `10,000` | rows i = 0 … 9 999 |
| Failures | `400` | 10 000 / 25 |
| First-pass yield % | `96` | 9 600 passes / 10 000 |
| Top failure code share % | `50` | the 400 failures have j = 0 … 399; F01 takes j mod 4 ∈ {0, 1}: 200 of 400 (F02 100, F03 100) |
| Average measurement mV | `5,045` | 4 800 + 10 · mean(0 … 49) = 4 800 + 245 |

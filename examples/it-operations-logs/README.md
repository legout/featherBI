# IT operations and logs

2 000 log events, one per minute: `logs.parquet` (`ts`, `service`, `level`, `latency_ms`).
Playbook: `skill/featherbi/references/domains/it-operations-logs.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 1999): `ts = 2025-03-01 00:00 + i` minutes; `service` by i mod 4 (api, db, auth, web);
`level` by i mod 10: ERROR at 0, WARN at 1 and 2, else INFO; `latency_ms = 50 + 10 · (i mod 10)` (50 … 140).

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Log events | `2,000` | rows 0 … 1999 |
| Errors | `200` | i mod 10 = 0 |
| Warnings | `400` | i mod 10 = 1 or 2 |
| Error rate % | `10` | 200 of 2 000 |
| Average latency ms | `95` | mean of 50, 60, … 140 |

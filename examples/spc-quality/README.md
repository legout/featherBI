# SPC / quality

Shaft diameters in 100 hourly subgroups of 5: 500 rows in `samples.parquet` (`sampled_at`, `subgroup`,
`diameter_mm`). Playbook: `skill/featherbi/references/domains/spc-quality.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 499): `subgroup = i div 5 + 1`, `pos = i mod 5`,
`diameter_mm = 10 + ((subgroup mod 5) − 2) · 0.004 + (pos − 2) · 0.01`, plus `0.1` in subgroup 77.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Measurements | `500` | 100 subgroups × 5 |
| Subgroups | `100` | i div 5 + 1 runs 1 … 100 |
| Average range mm | `0.04` | the position term spans −0.02 … +0.02 in every subgroup (the other terms are constant inside one), so every range is 0.04 |
| Highest subgroup mean mm | `10.1` | the position term averages 0; subgroup 77 has 77 mod 5 = 2, so 10 + 0 + 0.1 |
| Subgroups outside the limits | `1` | centre ≈ 10.001, width = 0.577 · 0.04 ≈ 0.023 (A2 for n = 5); the other means lie within 10 ± 0.008, subgroup 77 at 10.1 is outside |

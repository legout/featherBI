# OEE and downtime

Three machines, 20 days, one 480-minute shift each: `shifts.parquet` (60 rows) and `downtime.parquet`
(one stop per shift). Playbook: `skill/featherbi/references/domains/oee-downtime.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 59): `machine = M(i mod 3 + 1)`, `day = i div 3`. The stop starts at 09:00 and lasts
30 · (i mod 3 + 1) minutes (M1 30, M2 60, M3 90); its reason is `Jam` for day mod 4 ∈ {0, 1}, `Changeover`
for 2, `Tool break` for 3. `run_min = 480 − stop`; the ideal rate is 2 parts/min; `produced = run_min · 19 / 10`
(855, 798, 741); `scrap = produced div 50` (17, 15, 14).

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Downtime minutes | `3,600` | 20 days × (30 + 60 + 90) |
| Availability % | `87.5` | run 60 · 480 − 3 600 = 25 200 of planned 28 800 |
| Performance % | `95` | produced 20 · (855 + 798 + 741) = 47 880 of 2 · 25 200 = 50 400 |
| Quality % | `98.08` | scrap 20 · (17 + 15 + 14) = 920, so good 46 960 of 47 880 |
| OEE % | `81.53` | good 46 960 of the ideal output of the planned time 2 · 28 800 = 57 600 (= 0.875 · 0.95 · 0.9808) |

Pareto check: `Jam` has 10 days × 180 = 1 800 of the 3 600 downtime minutes (50 %).

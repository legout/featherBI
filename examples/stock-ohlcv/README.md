# Stock OHLCV

Two tickers, 100 days: `prices.parquet` (200 rows: `ticker`, `day`, `open`, `high`, `low`, `close`, `volume`).
Playbook: `skill/featherbi/references/domains/stock-ohlcv.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 199): `ticker` AAA for even `i`, BBB for odd; `d = i div 2` (0 … 99), `day = 2025-01-01 + d` days;
`open = 100 + 50 · (i mod 2) + d`; `close = open − 2` when d mod 4 = 3, else `open + 1`;
`high = max(open, close) + 2`; `low = min(open, close) − 1`; `volume = 1000 + 100 · (d mod 5)`.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Rows | `200` | 2 tickers × 100 days |
| Volume | `240,000` | d mod 5 runs 0 … 4: 5 000 + 100 · 10 = 6 000 per 5 days; 20 cycles = 120 000 per ticker; 2 tickers |
| Highest high | `251` | BBB opens 150 + d; at d = 98 open 248, close 249, high 251 (d = 99 gives 249 and 247, also 251) |
| Lowest low | `99` | AAA at d = 0: open 100, close 101, low 99 (d = 3 gives low 100) |
| AAA last close | `197` | d = 99 is 3 mod 4: open 199, close 199 − 2 |

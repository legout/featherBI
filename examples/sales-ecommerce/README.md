# Sales and e-commerce

1 000 orders over 30 days: `orders.parquet` (`order_id`, `order_date`, `channel`, `category`, `revenue`,
`units`, `returned`). Playbook: `skill/featherbi/references/domains/sales-ecommerce.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 999): `order_date = 2025-03-01 + (i mod 30)` days; `channel` by i mod 4 (Web, App, Marketplace,
Store); `category` by i mod 5 (Books, Toys, Garden, Sports, Home); `revenue = 20 + 10 · (i mod 10)`
(20 … 110); `units = 1 + i mod 3`; `returned = 1` when i mod 20 = 0.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Orders | `1,000` | rows 0 … 999 |
| Revenue | `65,000` | 100 cycles of ten rows, each 20 + 30 + … + 110 = 650 |
| Average order value | `65` | 65 000 / 1 000 (mean of 20 … 110) |
| Return rate % | `5` | i mod 20 = 0 gives 50 returns of 1 000 |

Pareto check: category c = i mod 5 collects revenues 20 + 10c and 70 + 10c per ten rows, so 100 · (90 + 20c):
Books 9 000, Toys 11 000, Garden 13 000, Sports 15 000, Home 17 000 (sum 65 000); `Home` leads.

# Support tickets

800 tickets over 30 days: `tickets.parquet` (`ticket_id`, `opened`, `channel`, `priority`, `status`,
`first_response_min`, `csat`). Playbook: `skill/featherbi/references/domains/support-tickets.md`.

    duckdb < make.sql
    node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 799): `opened = 2025-03-01 + (i mod 30)` days; `channel` by i mod 3 (Email, Chat, Phone);
`priority` by i mod 4 (Low, Medium, High, Urgent); `status = Open` when i mod 10 = 0, else Resolved;
`first_response_min = 10 + 5 · (i mod 8)` (10 … 45); `csat = 1 + i mod 5`.

## Figures (worked on paper from the rule, not read from a query)

| Tile | Shown | Derivation |
|---|---|---|
| Tickets | `800` | rows 0 … 799 |
| Open tickets | `80` | i mod 10 = 0 |
| Average first response min | `27.5` | mean of 10, 15, … 45 |
| Average CSAT | `3` | mean of 1 … 5 |

# Hand fixture

Twelve sales rows and two targets, small enough to add up by hand. The values below are the
oracle for the journey tests: they were worked out on paper from the rows, never copied from
a query result. `make.sql` regenerates `sales.parquet` and `targets.xlsx`.

## sales (12 rows)

| order_date | region | channel | revenue |
|---|---|---|---:|
| 2025-01-05 | EU | Online | 100.00 |
| 2025-01-05 | US | Online | 200.00 |
| 2025-01-15 | EU | Retail | 150.00 |
| 2025-01-25 | US | Retail | 250.00 |
| 2025-02-05 | EU | Online | 120.00 |
| 2025-02-05 | US | Online | 220.00 |
| 2025-02-15 | EU | Retail | 180.00 |
| 2025-02-25 | US | Retail | 270.00 |
| 2025-03-05 | EU | Online | 140.00 |
| 2025-03-05 | US | Online | 240.00 |
| 2025-03-15 | EU | Retail | 160.00 |
| 2025-03-25 | US | Retail | 230.50 |

`revenue` is `DECIMAL(10,2)`.

## targets (`targets.xlsx`)

| region | target |
|---|---:|
| EU | 800 |
| US | 1500 |

## Hand-computed values

Revenue by region and month:

| | 2025-01 | 2025-02 | 2025-03 | Total |
|---|---:|---:|---:|---:|
| EU | 100 + 150 = 250.00 | 120 + 180 = 300.00 | 140 + 160 = 300.00 | 850.00 |
| US | 200 + 250 = 450.00 | 220 + 270 = 490.00 | 240 + 230.50 = 470.50 | 1,410.50 |
| Total | 700.00 | 790.00 | 770.50 | **2,260.50** |

Revenue by channel:

| | EU | US | Total |
|---|---:|---:|---:|
| Online | 100 + 120 + 140 = 360.00 | 200 + 220 + 240 = 660.00 | 1,020.00 |
| Retail | 150 + 180 + 160 = 490.00 | 250 + 270 + 230.50 = 750.50 | 1,240.50 |

| Value | Expected | Shown as (`format: currency`) |
|---|---:|---|
| Revenue, no filter (hand total) | 2,260.50 | `$2,260.50` |
| Revenue, region = EU | 850.00 | `$850.00` |
| Revenue, channel = Online | 1,020.00 | `$1,020.00` |
| EU × 2025-02 pivot cell | 300.00 | `$300.00` |
| Rows, no filter | 12 | |
| Rows, region = EU | 6 | |

# Volume fixture

1 000 000 synthetic sales rows with the hand fixture's columns, plus `../hand/targets.xlsx`
(EU 800, US 1500). `tools/gen-volume.sql` writes `sales.parquet` here; the Parquet is git-ignored
and never committed:

    duckdb < tools/gen-volume.sql          # from the repo root
    cd fixtures/volume && node ../../skill/featherbi/scripts/featherbi.mjs build dashboard.yaml

Row `i` (0 … 999 999): `order_date = 2025-01-01 + i mod 90`; `region = EU` if `i` is even, else `US`;
`channel = Online` if `i mod 4` is 0 or 1, else `Retail`; `revenue = (i mod 10 000 + 1) / 100`.

## Hand-computed values (worked on paper, not read from a query)

The revenue pattern repeats every 10 000 rows, so there are 100 identical cycles. 10 000 divides by 2 and by 4,
so region and channel also repeat inside each cycle.

- Rows: 1 000 000. EU 500 000, US 500 000.
- One cycle: 1 + 2 + … + 10 000 = 50 005 000 cents = 500 050.00; the total is 100 × 500 050.00 = **50 005 000.00**.
- Maximum revenue: 10 000 / 100 = **100.00**. Average: 50 005 000 / 1 000 000 = 50.005.
- EU: revenue 1, 3, … 9 999 cents per cycle; 5 000² = 25 000 000 cents = 250 000.00; × 100 = **25 000 000.00**.
- US: 50 005 000.00 − 25 000 000.00 = 25 005 000.00.
- Online (r + 1 ≡ 1 or 2 mod 4): ≡ 1 gives 2 500 × (1 + 9 997) / 2 = 12 497 500 cents,
  ≡ 2 gives 2 500 × (2 + 9 998) / 2 = 12 500 000 cents; one cycle 249 975.00; × 100 = **24 997 500.00**.
- Targets (unchanged by any filter): EU 800, US 1 500.
- EU + Online (`i mod 4 = 0`, revenue 1, 5, … 9 997 cents per cycle): 2 500 × (1 + 9 997) / 2 = 12 497 500 cents; × 100 = **12 497 500.00**, 250 000 rows.

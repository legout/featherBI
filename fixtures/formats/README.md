# Format fixtures

One fixture per local source format, all holding the same five rows (`id`, `name`, `amount`).
The values are the oracle for `tests/sources.test.mjs`, added up by hand:

| id | name | amount |
|---|---|---:|
| 1 | a | 10.50 |
| 2 | b | 20.00 |
| 3 | c | 30.25 |
| 4 | d | 40.00 |
| 5 | e | 50.00 |

- rows: 5
- sum: 150.75  (10.50 + 20.00 + 30.25 + 40.00 + 50.00)

Fixtures: `items.csv`, `items.json`, `items.parquet`, `items.xlsx`, `items.sqlite` (table `items`),
`delta/`, `iceberg/ns/items` (metadata directory, with a `version-hint.text`) and
`items.ducklake` (table `items`, data in `items.ducklake.files/`).

`make.sql` regenerates all but Delta and Iceberg; `make.py` regenerates those two.
The Iceberg metadata holds absolute `file://` paths from the generating machine, so reading it
needs `allow_moved_paths`.

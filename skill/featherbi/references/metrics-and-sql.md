# Metrics and SQL guidance

## Metrics catalog

Define reusable `dimensions` and `measures` above a model so labels and formats stay consistent:

```yaml
models:
  inspection_model:
    sql: models/inspection_model.sql
    schema:
      station: {type: string, nullable: false}
      success_value: {type: integer, nullable: false}
dimensions:
  station: {model: inspection_model, field: station, label: Station}
measures:
  records: {model: inspection_model, aggregation: count, label: Records, format: integer, empty: zero}
  successes: {model: inspection_model, aggregation: sum, field: success_value, label: Successes, format: integer, empty: zero}
  success_rate:
    model: inspection_model
    ratio: {numerator: successes, denominator: records}
    label: Success rate
    format: decimal
    empty: "null"
    zero: "null"
```

Aggregations: `count`, `distinct-count`, `sum`, `min`, `max`, `average`; ratios combine two same-model measures and must declare zero/null behavior. Every measure declares `empty: null|zero`. Business meaning is supplied or confirmed by the user — the compiler expands definitions, it does not invent them.

## SQL admission (queries/*.sql and models/*.sql)

- Exactly one `SELECT` (CTEs allowed); no `;`-separated statements.
- No DDL/DML (`CREATE`, `INSERT`, `DELETE`, `UPDATE`, ...), `PRAGMA`, `INSTALL`/`LOAD`, `COPY`/`EXPORT`, file readers (`read_parquet`, `read_csv_auto`, ...), URLs, or filesystem paths.
- Referenced relations must be declared sources or earlier models; undeclared names fail.
- `?`-style constants are avoided; dashboard filters arrive as named `$parameter` placeholders declared in `params`, and each declared param must appear in the SQL exactly as declared (order included).
- Joins require a confirmed `relationships` entry (see project-reference.md).

Range filters emit `<id>_from`/`<id>_to`; the runtime binds a date-range `to` as an exclusive next-day boundary, so authored SQL uses `column < $id_to`. Scalar filters emit `<id>`. The conventional guard shape is `($id IS NULL OR column = $id)` so an unset filter means "all".

## Pagination and limits

Tables page server-side (100 rows/page); chart results cap at 10,000 rows. Keep query SQL orderable and deterministic (`ORDER BY` with a tiebreaker) so pages and revisions stay stable.

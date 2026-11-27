# End-of-line test

Playbook for brainstorming mode. Example: `examples/end-of-line-test/`.

## Detection signals

`serial` (unique per unit), `station`, a `result` column with PASS/FAIL, a `fail_code` that is NULL on PASS, numeric measurements (`meas_*`) beside `lsl`/`usl` limits. Grain: one row per unit test.

## Interview questions

- Who uses it: line lead or quality engineer? Default: line lead.
- What is the yield target? Default: none; never invent one.
- Break down by station, shift or product? Default: station.
- Which measurement matters, and are the limits in the data? Default: the first `meas_*` with its `lsl`/`usl`.
- Is the last test per serial the one that counts (retests)? Default: every row is a first pass.

## Figures

```sql
SELECT COUNT(*) AS value FROM tests;
SELECT COUNT(*) AS value FROM tests WHERE result = 'FAIL';
SELECT 100.0 * COUNT(*) FILTER (WHERE result = 'PASS') / COUNT(*) AS value FROM tests;
SELECT fail_code, COUNT(*) AS n FROM tests WHERE result = 'FAIL' GROUP BY 1 ORDER BY 2 DESC;
SELECT station, COUNT(*) FILTER (WHERE meas_mv < lsl OR meas_mv > usl) AS out_of_limits FROM tests GROUP BY 1 ORDER BY 1;
```

## Tile ideas

- KPIs: units, failures, first-pass yield. Is the line healthy?
- `pareto` of failures by `fail_code` (`click: fail_code`, `exclude: [fail_code]`). Which code to fix first?
- `histogram` of a measurement. Is it centred, how close to the limits?
- `bar` of failures by station. Is one station worse?

## Traps

- Retests: with several rows per serial, first-pass yield needs the first row per serial (`row_number()`), not all rows.
- Yield is a ratio: sum counts first, then divide; never average station percentages.
- Limits may differ per product: keep `lsl`/`usl` in the row, not as constants.
- Millivolts vs volts: say the unit in the tile title.
- A test log of millions of rows exceeds the 25 MB limit: aggregate per hour and station in the source SQL.

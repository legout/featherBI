# SPC / quality

Playbook for brainstorming mode. Example: `examples/spc-quality/`.

## Detection signals

A subgroup or sample number repeated 3–10 times, one numeric characteristic (`diameter_mm`, `weight_g`) around a target, a sampling time. Grain: one row per measured part.

## Interview questions

- Who reads the charts: operator or quality engineer? Default: quality engineer.
- Are specification limits (LSL/USL) known? Default: no; show control limits only.
- Subgroup size: the `subgroup` column, or a fixed number of rows? Default: the column.
- Should limits come from the whole period or a baseline period? Default: the whole period.
- Is there a drift or shift to look for? Default: points outside the limits.

## Figures

```sql
SELECT COUNT(DISTINCT subgroup) AS value FROM samples;
SELECT AVG(r) AS value FROM (SELECT MAX(diameter_mm) - MIN(diameter_mm) AS r FROM samples GROUP BY subgroup);
WITH g AS (
  SELECT subgroup, AVG(diameter_mm) AS m, MAX(diameter_mm) - MIN(diameter_mm) AS r FROM samples GROUP BY subgroup),
lim AS (SELECT AVG(m) AS centre, 0.577 * AVG(r) AS width FROM g)
SELECT g.subgroup, g.m FROM g, lim WHERE abs(g.m - lim.centre) > lim.width ORDER BY 1;
```

## Tile ideas

- `line` X-bar chart: subgroup mean with centre line and limits as extra series. Is the process in control?
- `line` range chart. Is the spread stable?
- `histogram` of the diameter. Is it centred, how wide?
- KPIs: measurements, subgroups, average range, points outside the limits.

## Traps

- The limits `centre ± 0.577 · average range` are for subgroups of exactly 5 (A2 = 0.577); other sizes need another constant (n = 3: 1.023, n = 4: 0.729).
- Control limits are not specification limits; do not mix them on one axis.
- Limits computed from data that contains the shift are widened by it; use a baseline period when one exists.
- Unequal subgroup sizes break the constants: check `COUNT(*)` per subgroup first.
- Filters on a time range recompute the limits from the filtered rows.

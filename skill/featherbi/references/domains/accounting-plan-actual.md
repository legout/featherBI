# Accounting plan vs actual

Playbook for brainstorming mode. Example: `examples/accounting-plan-actual/`.

## Detection signals

`plan`/`budget` and `actual` amounts per period (`month`) with a `dept`/`cost_center` and an `account`. Grain: one row per department, account and period.

## Interview questions

- Are the accounts costs or revenue? Default: costs (actual above plan is overspend).
- Which dimension first: department or account? Default: department.
- Is the period a month or a quarter? Default: month.
- Is a tolerance given for flagging a line? Default: any line over plan.
- Year to date or the whole range? Default: the whole range.

## Figures

```sql
SELECT SUM(plan) AS plan, SUM(actual) AS actual FROM ledger;
SELECT SUM(actual - plan) AS variance FROM ledger;
SELECT 100.0 * SUM(actual - plan) / NULLIF(SUM(plan), 0) AS variance_pct FROM ledger;
SELECT COUNT(*) AS lines_over_plan FROM ledger WHERE actual > plan;
SELECT account, SUM(actual - plan) AS variance FROM ledger GROUP BY 1 ORDER BY 1;
SELECT strftime(month, '%Y-%m') AS month, SUM(plan) AS plan, SUM(actual) AS actual FROM ledger GROUP BY 1 ORDER BY 1;
```

## Tile ideas

- KPIs: plan, actual, variance, variance %. Are we on budget?
- `waterfall` of variance by account. Which accounts add the overspend?
- `bar` of variance by department (`click: dept`). Who overspends?
- `line` of plan and actual by month. When did it drift?

## Traps

- The sign: for costs, actual minus plan above 0 is bad; for revenue it is good. Say which.
- Variance % divides by plan (`NULLIF(SUM(plan), 0)`: an unbudgeted line has no percentage, not infinity), never by actual, and by the summed plan, not an average of line percentages.
- Averaging per-line percentages weights a small line like a large one.
- Plan and actual must cover the same lines; a missing actual is not zero spend.
- Mixed currencies or cumulative (year to date) amounts must not be summed as monthly values.

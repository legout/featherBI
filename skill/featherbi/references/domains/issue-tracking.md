# Issue tracking

Playbook for brainstorming mode. Example: `examples/issue-tracking/`.

## Detection signals

An `issue_id`/`key`, an opened date, `type` (bug, feature, task), `status` (open, in progress, done), `points`/`estimate`, maybe `assignee`, `closed` date or `labels`. Grain: one row per issue.

## Interview questions

- Who is it for: team lead, product owner or management? Default: team lead.
- Which statuses mean not done? Default: everything except Done and Closed.
- Do points matter, or just counts? Default: counts, points as a second figure.
- Break down by type, assignee or label? Default: type.
- Is a sprint or release scope given? Default: none; never invent one.

## Figures

```sql
SELECT COUNT(*) AS issues FROM issues;
SELECT COUNT(*) AS not_done FROM issues WHERE status NOT IN ('Done', 'Closed');
SELECT COUNT(*) AS done FROM issues WHERE status IN ('Done', 'Closed');
SELECT COUNT(*) AS bugs FROM issues WHERE type = 'Bug';
SELECT AVG(points) AS average_points FROM issues;
SELECT status, COUNT(*) AS issues FROM issues GROUP BY 1 ORDER BY 2 DESC;
```

## Tile ideas

- KPIs: issues, not done, done, bugs, average points. How much work is left?
- `line` of issues opened per day. Is the intake growing?
- `bar` of issues by type. What kind of work is it?
- `funnel` of issues by status. Where does work wait?

## Traps

- A status snapshot is a point in time; a burn-down needs the status history, not the current column.
- Unestimated issues have NULL points; averages skip them, say how many.
- Reopened and duplicate issues inflate counts; count by id and drop duplicates.
- Labels and assignees can be multi-valued; a join multiplies rows.
- Cycle time of open issues is unknown, not zero.

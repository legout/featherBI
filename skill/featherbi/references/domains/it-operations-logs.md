# IT operations and logs

Playbook for brainstorming mode. Example: `examples/it-operations-logs/`.

## Detection signals

A `ts`/`timestamp` per event, a `service`/`host`, a `level` (ERROR/WARN/INFO), `latency_ms` or `duration`, maybe a `message` or `status_code`. Grain: one row per log event or request.

## Interview questions

- Who is it for: on-call engineer, service owner or management? Default: on-call engineer.
- Which levels count as errors? Default: ERROR only; WARN shown separately.
- Which window matters: last hour, day or the whole export? Default: the whole export.
- Break down by service, host or endpoint? Default: service.
- Is an SLO given (error rate, latency)? Default: none; never invent one.

## Figures

```sql
SELECT COUNT(*) AS log_events FROM logs;
SELECT COUNT(*) AS errors FROM logs WHERE level = 'ERROR';
SELECT COUNT(*) AS warnings FROM logs WHERE level = 'WARN';
SELECT 100.0 * COUNT(*) FILTER (WHERE level = 'ERROR') / NULLIF(COUNT(*), 0) AS error_rate_pct FROM logs;
SELECT AVG(latency_ms) AS average_latency_ms FROM logs;
SELECT strftime(ts, '%Y-%m-%d %H:00') AS hour, COUNT(*) AS events FROM logs GROUP BY 1 ORDER BY 1;
```

## Tile ideas

- KPIs: events, errors, warnings, error rate, latency. Is the system healthy?
- `line` of events per hour. When did it spike?
- `bar` of events by service. Which service is noisy?
- `donut` of events by level. How much is noise?

## Traps

- A rate with no events (a filter that selects none) is undefined: divide by `NULLIF(COUNT(*), 0)` so the KPI shows – instead of NaN.
- Group hours by date and hour (`%Y-%m-%d %H:00`), not hour of day, or days merge.
- Averages hide tails; latency needs percentiles (`quantile_cont`) for decisions.
- Logs are huge: aggregate in the source SQL; the snapshot has a 25 MB limit.
- One failure can log many lines; count requests or incidents, not lines, when you can.
- Clock skew and time zones between hosts shift events across hours.

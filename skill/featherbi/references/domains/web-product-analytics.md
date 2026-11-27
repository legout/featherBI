# Web and product analytics

Playbook for brainstorming mode. Example: `examples/web-product-analytics/`.

## Detection signals

`session_id` or `visitor`, a day or timestamp, `source`/`referrer`/`utm_*`, `pages`/`events` per session, a `converted` flag. Grain: one row per session (or per event: then count distinct sessions).

## Interview questions

- Who is it for: marketing, product or management? Default: marketing.
- Is a bounce a one-page session or a session without a second event? Default: one page.
- What counts as a conversion? Default: the flag in the data.
- Break down by source, device or landing page? Default: source.
- Is bot traffic already filtered? Default: assume yes and say so.

## Figures

```sql
SELECT COUNT(*) AS sessions FROM sessions;
SELECT 100.0 * COUNT(*) FILTER (WHERE pages = 1) / COUNT(*) AS bounce_rate FROM sessions;
SELECT AVG(pages) AS pages_per_session FROM sessions;
SELECT 100.0 * SUM(converted) / COUNT(*) AS conversion_rate FROM sessions;
SELECT source, COUNT(*) AS sessions, 100.0 * SUM(converted) / COUNT(*) AS conversion_rate FROM sessions GROUP BY 1 ORDER BY 2 DESC;
SELECT 'Sessions' AS step, COUNT(*) AS n FROM sessions UNION ALL SELECT 'Viewed 3+ pages', COUNT(*) FROM sessions WHERE pages >= 3 UNION ALL SELECT 'Converted', COUNT(*) FROM sessions WHERE converted = 1;
```

## Tile ideas

- KPIs: sessions, bounce rate, pages per session, conversion rate. Is the traffic good?
- `funnel` of sessions, deeper visits, conversions. Where do visitors drop?
- `line` of sessions per day. Spikes and weekday pattern?
- `bar` of sessions by source. Where does traffic come from?

## Traps

- Event rows: count distinct sessions, never rows.
- Funnel steps must be nested (a converted session also viewed pages); otherwise the funnel is not monotone.
- Rates are ratios of sums; never average per-day or per-source percentages.
- Time zones: a day boundary in UTC splits a local evening; state the zone.
- Sampled or consent-filtered data understates traffic.

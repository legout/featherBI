# SaaS subscriptions

Playbook for brainstorming mode. Example: `examples/saas-subscriptions/`.

## Detection signals

`customer`/`account`, `plan`, a monthly price (`mrr`, `price`), a start date, `status` (active/churned) or an end/cancel date. Grain: one row per subscription.

## Interview questions

- Who is it for: founder, finance or customer success? Default: founder.
- Is `mrr` monthly, or are annual plans stored as a yearly price? Default: use as monthly; ask when prices look 12 times too high.
- Does a paused or trial subscription count as active? Default: no.
- Snapshot (active now) or growth over time? Default: snapshot; growth and a churn rate need an end date per subscription.
- Break down by plan or start cohort? Default: plan.
- Is a churn or MRR target given? Default: none.

## Figures

```sql
SELECT COUNT(*) AS subscriptions FROM subscriptions WHERE status = 'active';
SELECT SUM(mrr) AS mrr FROM subscriptions WHERE status = 'active';
SELECT SUM(mrr) / COUNT(DISTINCT customer) AS arpa FROM subscriptions WHERE status = 'active';
SELECT 100.0 * COUNT(*) FILTER (WHERE status = 'churned') / COUNT(*) AS churned_share FROM subscriptions;
SELECT plan, SUM(mrr) AS mrr FROM subscriptions WHERE status = 'active' GROUP BY 1 ORDER BY 2 DESC;
SELECT strftime(started, '%Y-%m') AS month, COUNT(*) AS new_subscriptions FROM subscriptions GROUP BY 1 ORDER BY 1;
```

## Tile ideas

- KPIs: active subscriptions, MRR, churned share of all subscriptions. How big is the base now?
- `bar` of MRR by plan. Which plan pays the bills?
- `line` of new subscriptions by start month. Is acquisition slowing? (Starts only, not net growth.)
- `donut` of subscriptions by status. How big is the churned share?

## Traps

- A snapshot has no history: the churned share is churned of all ever started, not a churn rate; the same share results whether the losses were this month or long ago. A monthly rate needs an end date per subscription.
- MRR counts active rows only; including churned ones inflates it.
- Annual plans must be divided by 12 before summing.
- Currencies and discounts: sum one currency, and say whether `mrr` is net of discounts.
- Filtering by start date drops older customers from the MRR; say so.

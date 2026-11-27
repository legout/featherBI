# Sales and e-commerce

Playbook for brainstorming mode. Example: `examples/sales-ecommerce/`.

## Detection signals

`order_id`, an order date, `revenue`/`amount`, `units`/`quantity`, `channel`, `category`/`product`, optionally a `returned` or `refund` flag. Grain: one row per order line.

## Interview questions

- Who is it for: owner, category manager or marketing? Default: owner.
- Is revenue net or gross of tax, discounts and returns? Default: use the column as given and say which.
- Is one row an order or an order line? Default: line; count distinct `order_id` for orders.
- Break down by channel, category or both? Default: category.
- Is a target given? Default: none; never invent one.

## Figures

```sql
SELECT COUNT(DISTINCT order_id) AS orders FROM orders;
SELECT SUM(revenue) AS revenue FROM orders;
SELECT SUM(revenue) / COUNT(DISTINCT order_id) AS average_order_value FROM orders;
SELECT 100.0 * SUM(returned) / COUNT(*) AS return_rate FROM orders;
SELECT category, SUM(revenue) AS revenue FROM orders GROUP BY 1 ORDER BY 2 DESC;
SELECT channel, SUM(revenue) AS revenue FROM orders GROUP BY 1 ORDER BY 2 DESC;
```

## Tile ideas

- KPIs: orders, revenue, average order value, return rate. How is business?
- `line` of daily revenue. Trend and weekday pattern?
- `pareto` of revenue by category. Which categories carry the sales?
- `donut` of revenue by channel. Where do customers buy?

## Traps

- Several lines per order: average order value divides by distinct orders, not rows.
- Returns: revenue is gross unless refunds are netted out; say which.
- Currencies and tax: never add amounts of different currencies.
- A partial last day understates the trend; filter it out or say so.
- Average of per-order values across groups is not the group's average; divide sums.

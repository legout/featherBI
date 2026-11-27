# Stock OHLCV

Playbook for brainstorming mode. Example: `examples/stock-ohlcv/`.

## Detection signals

A `ticker`/`symbol`, a trading day, and `open`, `high`, `low`, `close` (often `volume`). Grain: one row per ticker per day (or bar).

## Interview questions

- Which tickers matter, or all? Default: all, one candlestick tile for the first.
- Daily bars or intraday? Default: as given.
- Are prices split/dividend adjusted? Default: assume yes; ask when jumps of -50% appear.
- Compare tickers or study one? Default: study one, compare volume.
- Is a period given? Default: all data.

## Figures

```sql
SELECT COUNT(*) AS bars FROM prices;
SELECT SUM(volume) AS volume FROM prices;
SELECT MAX(high) AS highest_high, MIN(low) AS lowest_low FROM prices;
SELECT ticker, arg_max(close, day) AS last_close FROM prices GROUP BY 1 ORDER BY 1;
SELECT ticker, 100.0 * (arg_max(close, day) / arg_min(close, day) - 1) AS change_pct FROM prices GROUP BY 1 ORDER BY 1;
```

## Tile ideas

- KPIs: last close, highest high, lowest low, volume. Where is the price now and what was its range?
- `candlestick` of one ticker with `volume`. What did each day do?
- `bar` of volume by ticker (`click: ticker`). Which ticker trades most?

## Traps

- Prices of different tickers must not share one candlestick tile; filter to one ticker.
- `high` and `low` bound `open` and `close`; check `low <= open, close <= high`.
- Unadjusted splits look like crashes.
- Summing `close` is meaningless; use the last value (`arg_max`) or a return.
- Weekends and holidays are missing days, not zeros.

# AP Inspection Activity & Data Quality

Status: written specification and disposable browser-feasibility probe approved by the owner. The owner subsequently approved the five implementation plans; execution follows their supervised gates.

## Sources and scope

- Originating concept: [featherBI brainstorm](../../brainstorm_serverless_ai_dashboards.md), especially §§3–7 and §12.
- Owner decisions in the planning conversation: agent → dashboard → share first; local CSV, Parquet, and JSON; desktop Chrome; internet-dependent runtime allowed; embedded HTML and ZIP bundles with separate data files; recipients may select/drop files after opening HTML and may see every shared row.
- Latest owner decision after the probe: skip Edge browser work and proceed without it. Chrome is the current validation target; Edge support is not claimed.
- Owner approved the proposed AP dashboard and profiling findings with “looks good”. This specification records that scenario, not the complete featherBI runtime architecture.
- [Tracker convention](../agents/issue-tracker.md): local Markdown tickets when execution planning requires them.

The first dashboard answers: how much inspection activity is recorded, where and for which products, and what recorded codes or data-quality signals warrant investigation?

## Reference dataset

Local owner-provided file: `/Users/volker/data/ewn/ap_unified.parquet`.

Inspection baseline (native DuckDB 1.5.5):

- 390,798,150 bytes (372.69 MiB), 5,384,125 rows, 70 columns.
- Timestamp range: 2017-01-02 05:04:43 through 2026-08-26 12:26:34.
- 1,064,008 distinct order numbers; 48,448 distinct non-null product MLFBs; 63 stations.
- `ap1` ends at 2023-11-22 18:29:42; `ap2` starts at 2023-11-22 18:29:46.
- 122 null product MLFBs, 99 null `dut_seq` values, 22 empty sequence-number strings.

These are snapshot-specific observations, not permanent validation constraints on user data. Do not copy the dataset into the repository or publish it as a test fixture. Native query success does not establish browser feasibility.

Required dashboard fields:

- Strings: `source`, `order_number`, `test_station_identifier`, `sequence_number`, `G0003`, `product_mlfb`.
- Timestamp: `inspection_date` (the file has no timezone annotation).
- Boolean: `is_last_measurement`.

Use `inspection_date`, not `year_month_identifier`, for calendar grouping. The latter contains labels such as `U8`, `U9`, and `00`.

## Metrics and population

A record is one input row. Do not silently deduplicate or equate records with devices, unique tests, or production units.

The initial population is the last 30 calendar dates ending on the maximum inspection date in the loaded file, independent of the current wall clock. For this snapshot it is 2026-07-28 through 2026-08-26; the final day must be marked potentially incomplete.

After filtering, calculate:

1. Inspection records: `count(*)`.
2. Distinct orders: `count(DISTINCT order_number)`.
3. Distinct products: `count(DISTINCT product_mlfb)`; null is not a distinct product.
4. Active stations: `count(DISTINCT test_station_identifier)`.
5. Records with a G0003 code: rows where `G0003 IS NOT NULL`, plus their percentage of all selected records. This definition measures non-null presence, not code validity or failure.
6. Records not marked as last measurement: rows where `is_last_measurement = false`, plus their percentage of all selected records. This is not a retest rate; null flags must not be counted as false.

Distinct counts must be recomputed over the selected rows, never summed from station, day, or product aggregates. For an empty population, show zero counts and unavailable percentages rather than divide by zero or display an apparent 0% quality rate.

## Views and filters

- Daily record volume split by source. Annotate the historical source transition when it lies within the displayed range.
- Station activity: horizontal bars of record counts; do not label this utilization or performance.
- Top 10 product MLFBs by record count, with remaining products grouped as “Other”. Missing product labels remain distinguishable from real products.
- G0003 frequency among non-null codes. Show raw labels until an authoritative dictionary establishes their meanings.
- Station × day heatmap of record counts. A gap indicates no records, not proven downtime.
- Filtered record table: timestamp, order, product, station, source, sequence, G0003, and last-measurement flag. Do not render millions of DOM rows; table paging and result limits belong to the runtime specification.

Shared filters: date range, source, station, searchable product, and order lookup. They apply to the same underlying population for all cards, charts, and the table. Chart-click cross-filtering is not required by this scenario.

## Observable acceptance examples

- **AP-01 — Default population:** loading the reference snapshot selects 2026-07-28 through 2026-08-26, even when today's date is later, and flags the final day as potentially incomplete.
- **AP-02 — Metric baseline:** the default population produces 34,596 records, 11,151 orders, 4,618 products, and 27 active stations. G0003 presence is 3,105 records (8.98%); false last-measurement flags are 2,120 records (6.13%).
- **AP-03 — Chart baseline:** default-window station counts include SJ = 2,585 and SD = 2,476. Code counts include PE100 = 1,547, PE101 = 467, and F165 = 365. Neither chart calls these failure or utilization measurements.
- **AP-04 — Population consistency:** source/station/product count groupings, including missing-value groups where present, reconcile to the selected record count. Selecting a filter updates every view; distinct-order and product KPIs use the filtered rows directly.
- **AP-05 — Honest semantics:** cards and legends distinguish records from units; no yield, scrap, retest, downtime, or physical-measurement claim is inferred from undocumented fields.
- **AP-06 — Sharing:** embedded HTML and an extracted HTML-plus-data bundle reproduce equivalent results for the same logical rows. The bundle allows explicit data selection/drop without requiring a local server. Browser validation targets desktop Chrome. Edge checks were removed by the owner's subsequent scope decision.
- **AP-07 — Scale evidence:** the full 372.69 MiB reference file is exercised separately from a small functional fixture. Record browser versions, device characteristics, load/query times, and available memory evidence or explicit failures. The [browser probe](browser-feasibility-report.md) establishes feasibility for the tested Chrome workload, not a general file-size guarantee or latency promise.

### Reference SQL for AP-02

The `ap` relation represents the local Parquet file. The path is supplied by the verification harness, not embedded in a distributable dashboard config.

```sql
WITH bounds AS (
    SELECT date_trunc('day', max(inspection_date)) AS latest_day
    FROM ap
), selected AS (
    SELECT ap.*
    FROM ap CROSS JOIN bounds
    WHERE inspection_date >= latest_day - INTERVAL 29 DAY
      AND inspection_date < latest_day + INTERVAL 1 DAY
)
SELECT
    count(*) AS records,
    count(DISTINCT order_number) AS orders,
    count(DISTINCT product_mlfb) AS products,
    count(DISTINCT test_station_identifier) AS stations,
    count(*) FILTER (WHERE G0003 IS NOT NULL) AS code_present,
    round(100.0 * count(*) FILTER (WHERE G0003 IS NOT NULL)
          / nullif(count(*), 0), 2) AS code_present_pct,
    count(*) FILTER (WHERE is_last_measurement = false) AS non_last,
    round(100.0 * count(*) FILTER (WHERE is_last_measurement = false)
          / nullif(count(*), 0), 2) AS non_last_pct
FROM selected;
```

## Boundaries for subsequent specifications

- Unique-unit identity and pass/fail semantics require authoritative definitions. `(order_number, sequence_number)` can span sources/stations and contain multiple rows flagged as last; it is not an approved unit key.
- The M*/E* fields have no verified business names or units here. Do not invent cycle-time, yield, or engineering charts from their numeric types.
- The [browser probe](browser-feasibility-report.md) provides positive Chrome evidence for `file://` startup, remote runtime assets, file selection, query/render, and small-fixture embedded/bundle parity. Production packaging, peak memory, OS-level drag/drop, and cold-network behavior still need implementation-specific checks.
- The cross-format CSV/JSON normalization contract, timestamp/timezone policy, null/error presentation, exact filter matching rules, query/result limits, and dependency distribution belong to the next design section. This scenario does not settle them.
- DuckLake, authenticated connectors, hub, lab, doc, and chat are outside this first-dashboard scope.

The owner approved this written scenario, the disposable browser probe, and subsequently the five implementation plans under `docs/plans/`. Production work follows those plans and their supervised baseline, review, integration, and publication gates; the probe alone is not production acceptance evidence.

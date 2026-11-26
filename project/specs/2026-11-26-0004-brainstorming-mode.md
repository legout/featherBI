# Spec 0004: brainstorming mode, richer profile, domain playbooks and four presets

Status: **approved**, revision 1 (owner, 2026-11-26, "genehmigt"). Owner choices so far (2026-11-26): brainstorming mode is a must; first wave covers all four domain groups; four new presets (Pareto, histogram, candlestick, timeline) in the same round.
Builds on: [spec 0001](2026-11-24-0001-featherbi-v1.md) r4 (workflow, `profile`, presets, tile contracts).

## Goal

When a user hands over data without saying what to show ("make me a dashboard from this"), the agent explores the data with them: it profiles the data, recognises what kind of data it is, asks a few questions, proposes concrete dashboard ideas, and builds the one the user picks. The skill knows typical questions, figures and traps for 20 common data domains.

## Flow (skill instructions, `SKILL.md` + `references/brainstorm.md`)

1. **When:** the request names data but not what to show, or the user asks for ideas. When the user already says what they want, the agent skips the mode and builds as today.
2. **Profile** every source with the richer `profile` (below).
3. **Recognise the domain** from column names, types, value patterns and grain, using the detection signals in `references/domains/*.md`. The agent states its guess and the evidence in one or two lines ("looks like end-of-line test data: `serial`, `station`, `result` = PASS/FAIL, `meas_*` with `lsl`/`usl`"). Unclear or mixed: it says so and asks.
4. **Interview:** one round of at most five questions, taken from the domain playbook and adapted to the data: audience, the decision the dashboard supports, time grain, breakdowns, what counts as good or bad (targets, limits). It uses the host's structured question tool when there is one, otherwise plain text, and offers a sensible default for each question.
5. **Propose** 3 dashboard ideas. Each has a title, its audience, and 4–8 tiles; each tile names the question it answers, its tile type/preset and the columns it uses. Every column named must exist in the profile; anything assumed (a unit, a limit, a currency) is marked as an assumption.
6. **Build** the idea the user picks (or edits), following the existing workflow, and report as today.

## Richer `profile`

The output stays a JSON array with one object per source; existing fields stay unchanged. New per-column fields:

| Field | For | Meaning |
|---|---|---|
| `nulls` | all | share of NULLs, 0–1 |
| `distinct` | all | count of distinct values (approximate allowed above 100 000 rows, marked `distinct_approx: true`) |
| `min`, `max` | numeric, date, timestamp | |
| `top` | text with ≤ 50 distinct values | up to 10 `{value, count}`, most frequent first |
| `step` | date, timestamp | median gap between consecutive distinct values, as a DuckDB interval string (e.g. `10 days`, `00:15:00`) |

Per source: `count` (as today) and `sampled: true` when the profile was computed on a sample. Sources above 5 M rows are profiled on a 1 M-row sample; the full count is still exact. `profile` never writes files and never sends data anywhere.

## Domain playbooks (`references/domains/<domain>.md`)

One file per domain, each with the same five sections: **Detection signals**, **Interview questions** (5–8 to choose from), **Figures** (KPIs with a DuckDB SQL recipe each), **Tile ideas** (preset + question answered), **Traps** (units, time zones, downsampling under the 25 MB limit, double counting, survivorship, …). An index `references/domains.md` lists all domains with their detection signals in one table, so the agent reads only the matching playbook.

First wave (20):

| Group | Domains |
|---|---|
| Industry | sensor time series, end-of-line test, SPC/quality, OEE and downtime, energy/smart meter |
| Vehicle | vehicle telematics, fleet and maintenance |
| Environment | weather, air quality |
| Finance | stock OHLCV, accounting plan/actual |
| Commerce | sales/e-commerce, SaaS subscriptions, web/product analytics |
| Operations | logistics, support tickets, IT operations/logs, issue tracking, HR, sports/tournament results |

## Examples (`examples/<domain>/`, outside `skill/`)

One per domain: a deterministic generator (`make.sql`, DuckDB, no network), a `dashboard.yaml` built from the playbook's first tile ideas, and a README with the hand-checkable figures the generator guarantees (as `fixtures/hand`). Generated data only; the Parquet is git-ignored and produced by the generator. CI builds every example once. Public datasets are a later decision (licence per dataset).

## Four new presets

Same contract style as the existing 17 (`references/presets.md`); each validated at build time like the others.

| Preset | Columns | Optional | Click | Notes |
|---|---|---|---|---|
| `pareto` | `x, y` | | `x` | Bars sorted by `y` descending, plus a cumulative-share line on a 0–100 % right axis; computed in the page from the rows. |
| `histogram` | `lo, hi, count` | `series` | none | Contiguous bars on a numeric axis from `lo` to `hi`; bins come from SQL (`references/presets.md` gives a `floor`-based recipe). |
| `candlestick` | `x, open, high, low, close` | `volume` | `x` | Rising/falling in the theme's success/error colours (already in the chart theme); `volume` as bars on a second grid below. |
| `timeline` | `name, start, end` | `state` | `name` | One row per `name`, a bar from `start` to `end` (timestamps) coloured by `state`; for downtime, machine states, charging sessions. |

## Non-goals

- The agent never invents data, columns or figures, and never builds before the user has picked an idea in this mode.
- No machine learning, forecasting or anomaly detection; figures are SQL aggregates.
- Maps, geographic presets, public-dataset downloads, domains beyond the 20.
- Changing the existing 17 presets.

## Acceptance examples

1. **Profile.** On the hand fixture (`fixtures/hand/README.md`), `profile` reports for `revenue` `min` 100.00, `max` 270.00, `nulls` 0, `distinct` 12; for `region` `top` EU 6, US 6; for `order_date` `min` 2025-01-05, `max` 2025-03-25, `distinct` 9 and `step` `10 days` (gaps 10, 10, 11, 10, 10, 8, 10, 10). A 6 M-row generated source reports `sampled: true` and the exact `count`.
2. **Presets.** Each new preset renders on a hand-made fixture with known values (Pareto cumulative line ends at 100 %; histogram bars touch; candlestick shows a rising day in the success colour; timeline bar spans start to end), in Chrome and Firefox, with build-time rejections for missing columns as for the existing presets.
3. **Examples.** All 20 examples build without errors in CI; each README's figures match its KPIs on the built page (one Playwright check per example over `file://`).
4. **Cold-agent run (manual, owner).** In a fresh folder with only one example's data and the installed skill, the request "make me a dashboard from this data" leads, without further help, to: the right domain guess with evidence, at most five questions, three ideas whose columns all exist, and a working build of the picked idea. Run for at least three domains from different groups.
5. **Skip.** A specific request ("revenue by month as a bar chart") builds directly, without the interview.

## Capture checkpoint

- **Vocabulary:** adds **brainstorming mode** (profile → domain guess → interview → proposals → build) and **domain playbook** (a per-domain reference the agent reads in that mode) to CONTEXT.md on approval.
- **Decisions:** no new ADR; the mode is skill instructions plus a richer existing command, within ADR 0001/0002.
- **Uncertainty:**
  - whether all hosts' models follow the mode reliably (acceptance 4 is the check);
  - CI time for 20 example builds plus 20 page checks (the plan measures it and may group the page checks);
  - public datasets are deferred, not decided.

# Spec 0005: SQL tables, locale, KPI notes, header line, sections and a replaceable page shell

Status: **proposed**, revision 1 (2026-11-26). Not approved. Owner direction so far (2026-11-26): take over the useful parts of two hand-built single-file dashboard drafts (SQL result tables, number formats, KPI notes, a data-status line, sections or tabs), and prepare the page so a separately maintained derived edition can replace its UI components without forking the renderer.
Builds on: [spec 0001](2026-11-24-0001-featherbi-v1.md) r4 (tiles, filters, layout, determinism) and [spec 0003](2026-11-26-0003-themes.md) r1 (theme key and logo in the header).
Architecture: [ADR 0001](../adr/0001-dashboard-stack.md) (DaisyUI 5 + Tailwind 4, ECharts, AG Grid, one generic renderer), [ADR 0002](../adr/0002-repository-is-the-skill.md).
Contract: planning-contract v1.

## Goal

Large dashboards stay readable and trustworthy:

- a table tile can show any tile-SQL result, so lists of anomalies, top/bottom rows or data-quality findings need no extra source;
- numbers, percentages and dates appear in the reader's language;
- a KPI can carry one line that explains it;
- the header shows how fresh the data is and where it comes from;
- tiles can be grouped into titled sections, shown stacked or as tabs;
- the page chrome is built through one small, documented interface, so a derived edition can render the same dashboards with another component library.

## Scope

### 1. Table tile with SQL

- A `table` tile has exactly one of `source` (as today) or `sql`.
- With `sql`:
  - The SQL is tile SQL (spec 0001): only snapshot tables, `{{filters:<table>}}` in each `WHERE`, validated twice at build time like every other tile.
  - The columns are the result's columns, in SQL order. `columns` is not allowed together with `sql`.
  - The rows are shown in the order the SQL returns them; header clicks sort the loaded rows in the browser only.
  - The result is capped at **1 000 rows**: the renderer appends `LIMIT 1001`; when 1 001 rows arrive, it shows 1 000 and the note "first 1 000 rows". (`source` tables keep their paged infinite scroll.)
  - The title shows the row count as today (`<title> · <n> rows`, or `· first 1 000 rows`).
  - Optional `click: <dim>`: clicking a row sets that dimension to the row's value in the **first** column; clicking the same value again clears it (spec 0001 click rules). The dimension must be declared, and the first column must exist.
- **Build rejection:** both `source` and `sql`, neither of them, `columns` with `sql`, an undeclared `click` dimension.

### 2. Locale and number formats

- New optional top-level key `locale` (a BCP 47 tag, e.g. `de-DE`). Default `en-US`, which renders exactly as today.
- It applies to every number the renderer formats (KPI values and Δ %, chart tooltips and value-axis labels, pivot cells, table cells) and to dates the renderer formats (table date column, the header line in §4).
- Dates use the locale's numeric short form (`2-digit` day and month, `numeric` year, UTC): `05.01.2025` in `de-DE`, `01/05/2025` in `en-US`. Without `locale` the table date column stays ISO (`2025-01-05`) as today.
- Separators are what `Intl` produces for the locale, including non-breaking spaces (`2.260,50 €`, `25 %`).
- `format` (on `kpi`, `echarts`, `pivot`) accepts, besides `number` and `currency`:
  - `percent`: the value is a ratio (0.25 → 25 %);
  - an object `{ style: number | currency | percent, decimals: <0–6>, currency: <ISO 4217>, unit: <text> }`, every key optional. `decimals` fixes both minimum and maximum fraction digits; `unit` is appended after a non-breaking space (`88.66 m³/t`).
- `format: currency` without a currency stays US dollars; a `currency` key selects another one.
- **Build rejection:** a `locale` the build's `Intl` does not support (checked with `Intl.NumberFormat.supportedLocalesOf`), an unknown `style`, `decimals` outside 0–6, a currency code that is not three letters.

### 3. KPI note

- `kpi` accepts `note`: plain text, at most 200 characters, shown in small type under the value (no Markdown, no HTML).
- Without `note` the KPI renders exactly as today.

### 4. Header line: data status, period, source

- When the config has `date`, the header shows one line under the title: `Data as of <max date> · Period <min date> – <max date>`, with the dates of all dated snapshot tables, formatted in `locale`.
- Optional top-level `subtitle` (text, at most 200 characters) is shown before that line.
- Optional top-level `source_label` (text, at most 200 characters) adds `· Source <label>`. Without it no source is shown: source SQL, paths, hosts and bucket names never appear in the page.
- The dates come from the snapshot at build time and are embedded; the line does not change with filters.
- Without `date`, `subtitle` and `source_label` the header is exactly as today. The remote expiry line of spec 0002 stays as it is.

### 5. Sections and tabs

- A config has exactly one of `tiles` (as today) or `sections`.
- `sections` is a list of `{ title, tiles }`; `title` is required and unique; every section has at least one tile. Tile ids stay unique across all sections.
- Top-level `layout: stack | tabs`, default `stack`; it is only allowed with `sections`.
  - `stack`: each section is a titled group in config order; KPIs of a section sit in their own row at the top of that section, as the page does today.
  - `tabs`: one tab per section, in config order, the first one open on load.
- **Filters** (filter bar, chips, Reset, cross-filter clicks, URL hash) work across all sections exactly as in spec 0001.
- **Tabs and queries:** tiles in a closed tab do not query. Opening a tab queries its tiles for the current filter state; latest state wins (spec 0001) applies per tab.
- **URL hash:** the open tab is added as `tab=<n>` (1-based) when it is not the first. On load an invalid or out-of-range value is ignored, like every other hash part.
- **Accessibility:** `role=tablist`, `tab`, `tabpanel`; arrow keys move between tabs, Home and End jump to the first and last; the open tab has `aria-selected=true`.
- **Errors** name the section and the tile: `section "<title>", tile "<id or number>": …`.

### 6. Replaceable page shell

- The renderer creates the page chrome only through one module, the **shell**: the header (title, logo from spec 0003, header line, theme toggle, Explore button), the filter bar (selects, date inputs, chips, Reset), the section or tab container, the tile cards (title, busy state, error state), the KPI card, the table host and the Explore dialog.
- The default shell is `skill/featherbi/assets/shell.js` and renders today's DaisyUI markup. With the default shell the HTML of every existing fixture is **byte-identical** to the build before this change.
- `references/shell.md` documents the shell interface as a versioned contract (`shell: 1`): each function, its arguments, what it returns and which events it reports back (filter change, tab change, Explore open, theme toggle). Charts (ECharts) and the grid (AG Grid) stay in the renderer; a shell gets the DOM element to mount them in.
- **Selecting a shell:** the dashboard config has no shell key. A shell is chosen by the skill installation: `build --shell <file>` (a path) uses that file instead of the default. The build inlines it like the renderer; `--offline` inlines it too. The build fails when the file is missing or does not declare `shell: 1`.
- No other shell ships in this repository.

## Non-goals

- Range selection (brush) as a filter, multi-select per dimension, and loading data in the viewer's browser at run time. They change spec 0001 rules and ADR 0001 and get their own specs or ADRs.
- Sorting, filtering or paging of `sql` tables in SQL; per-column formats in tables; CSV export.
- A shell key in `dashboard.yaml`, shells for specific companies or brands in this repository, theme engine work beyond spec 0003.
- Nested sections, per-section filters, or dragging tiles.
- Translating the page's own UI strings (button labels such as "Reset"); `locale` changes formats only.

## Acceptance examples

Fixture: the hand fixture (`fixtures/hand`, 12 sales rows, oracle values in its README).

1. **Default unchanged.** Every existing fixture config builds byte-identical HTML before and after this change (default shell, no new keys).
2. **SQL table.** A `table` tile with `sql: SELECT region, SUM(revenue) AS revenue FROM sales WHERE {{filters:sales}} GROUP BY 1 ORDER BY 1` shows 2 rows, EU 850.00 and US 1,410.50; after selecting channel Online it shows EU 360.00 and US 660.00. With `click: region`, clicking the EU row sets region = EU: the Revenue KPI shows 850.00.
3. **Row cap.** A `sql` table over a 1 001-row result shows 1 000 rows and "first 1 000 rows"; over a 1 000-row result it shows all 1 000 and no note.
4. **Locale.** With `locale: de-DE`, the hand fixture's Revenue KPI with `format: {style: currency, currency: EUR}` shows `2.260,50 €`; a KPI with `format: {decimals: 1, unit: t}` and value 1234.5 shows `1.234,5 t`; `format: percent` with value 0.25 shows `25 %`; the table date column shows `05.01.2025` for 2025-01-05.
5. **KPI note.** A KPI with `note: "Sum of revenue, net"` shows that line under the value; the same KPI without `note` is unchanged.
6. **Header line.** The hand fixture with `date` and `source_label: Sales export` shows `Data as of 03/25/2025 · Period 01/05/2025 – 03/25/2025 · Source Sales export` (no `locale`, so `en-US`), and the page contains no source path. With `locale: de-DE` it shows `Data as of 25.03.2025 · Period 05.01.2025 – 25.03.2025 · Source Sales export`.
7. **Tabs.** A config with two sections and `layout: tabs`: on load only the first tab's tiles have queried; selecting region EU in the filter bar, then opening tab 2, shows EU values there. The URL hash is `#region=EU&tab=2`; opening it in a fresh tab opens tab 2 with EU. Arrow keys switch tabs. Checked in Chrome and Firefox, 0 console errors.
8. **Stack.** The same config with `layout: stack` shows both section titles and all tiles; values equal acceptance 7.
9. **Shell.** `build --shell <test shell>` with a test shell that renders plain `<div>`s builds the hand fixture; the KPI values equal acceptance 2 of spec 0001 and a click filter works. A shell file without `shell: 1` stops the build. Explore and the date filter work with the test shell.
10. **Errors.** Each build rejection listed in §1, §2 and §5 stops the build with an error naming the tile (and section), and no HTML is written.

## Capture checkpoint

- **Vocabulary:** adds **section** (a titled group of tiles), **layout** (`stack` or `tabs`), **shell** (the module that renders the page chrome) and **header line** to CONTEXT.md on approval.
- **Decisions:** a replaceable shell is a new extension point; it is an architectural choice (costly to reverse once a derived edition depends on it). **Proposed ADR 0003 "Replaceable page shell"** for approval with this spec: the renderer keeps engine, filters, charts and grid; the shell owns chrome; the contract is versioned; no shell key in the config. Everything else stays within ADR 0001.
- **Behavior:** this spec.
- **Uncertainty (blocking for §6 only):**
  - Whether a Web Components library rendered by a shell works from `file://` and in an `--offline` build is not verified. A probe should precede the plan task for §6; §1–§5 do not depend on it.
  - The exact shell function list is fixed in the plan; this spec fixes its scope and the byte-identity rule.

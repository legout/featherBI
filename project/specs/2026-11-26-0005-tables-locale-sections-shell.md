# Spec 0005: SQL tables, locale, KPI notes, header line, sections and a replaceable page shell

Status: **approved**, revision 3 (§6, acceptance 9 and the §6 uncertainty note only: owner approved shell proposal A r1 on 2026-11-27, [proposal](https://github.com/legout/featherBI/issues/125#issuecomment-7229085010), [approval](https://github.com/legout/featherBI/issues/125#issuecomment-7237161123); all other sections stay as approved in revision 2, owner 2026-11-26). Revision 3 replaces §6 and acceptance 9 with the complete public shell v1 contract and fixes acceptance 9; the remaining text is unchanged. Revision 2 (owner decisions after the foreman's comparison with specs 0001–0004 and the code): "unchanged" means the same rendered page, not byte-identical HTML (the renderer and template are embedded, so any renderer change alters the bytes); table numbers follow the locale and the column's decimal scale; `tab` is a reserved dimension name; ADR 0003 amends ADR 0001's single-renderer rule. §6 is planned after a spike on Web Components under `file://` and `--offline`. Revision 1 owner direction (2026-11-26): take over the useful parts of two hand-built single-file dashboard drafts (SQL result tables, number formats, KPI notes, a data-status line, sections or tabs), and prepare the page so a separately maintained derived edition can replace its UI components without forking the renderer.
Builds on: [spec 0001](2026-11-24-0001-featherbi-v1.md) r4 (tiles, filters, layout, determinism) and [spec 0003](2026-11-26-0003-themes.md) r1 (theme key and logo in the header).
Architecture: [ADR 0001](../adr/0001-dashboard-stack.md) (DaisyUI 5 + Tailwind 4, ECharts, AG Grid, one generic renderer; amended by ADR 0003), [ADR 0002](../adr/0002-repository-is-the-skill.md), [ADR 0003](../adr/0003-replaceable-page-shell.md) (renderer/shell split).
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
- **Table cells** (`source` and `sql` tables) format numbers with the locale and, for `DECIMAL(p,s)` columns, exactly `s` fraction digits (`850.00`, `1,410.50` in `en-US`); other numeric columns use at most 2. This applies with and without `locale` and is a deliberate change: today table cells show raw values (`1410.5`).
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
- **URL hash:** the open tab is added as `tab=<n>` (1-based) when it is not the first. On load an invalid or out-of-range value is ignored, like every other hash part. `tab` is a reserved dimension name, like `date` (build rejection: a dimension named `tab`).
- **Accessibility:** `role=tablist`, `tab`, `tabpanel`; arrow keys move between tabs, Home and End jump to the first and last; the open tab has `aria-selected=true`.
- **Errors** name the section and the tile: `section "<title>", tile "<id or number>": …`.
- **Build rejection:** both `tiles` and `sections`, neither, `layout` without `sections`, a section without `title` or tiles, a duplicate section title, a dimension named `tab`.

### 6. Replaceable page shell

Approved in revision 3 (below). The interface is **mount once, update through handles**: one synchronous `mount` call per page returns the tile and viewer hosts plus a few display setters. A user gesture travels back to the renderer as an action; a shell never runs a query. Plain-DOM and Web Components shells use the same interface and need no DaisyUI selector.

#### 6.1 Roles

- The renderer keeps engine, snapshot, SQL, filter state, hash, formatting, ECharts, both AG Grid models (paging, sorting, row/keyboard clicks), the pivot's result table with its row-link clicks, safe Markdown content, and Perspective.
- The shell owns all chrome: header (title, logo left of the title, subtitle, header line, theme control, icons), filter bar (labeled selectors, All, From/To, chips, Reset), section/tab container, cards, headings, busy/skeleton, error and empty messages, KPI value/delta/sparkline/note, table host, remote progress and the Explore launcher and dialog. The renderer may populate its host and theme a library instance but never reads, queries or mutates a shell control, card wrapper, heading or dialog.
- The shell is trusted executable viewer code, **not** sandboxed. Shells using shadow DOM must keep library CSS/layout effective in their hosts (light-DOM slots are an option).
- The default shell is `skill/featherbi/assets/shell.js` and renders today's DaisyUI markup. No other shell ships in this repository.

#### 6.2 File format and selection

- A shell is one UTF-8, self-contained browser ES module. Its **first line**, after an optional BOM and ignoring the LF/CRLF terminator, is exactly `export const manifest = { shell: 1 };` (a packaging convention, so a prebundler can prepend it). Its other required named export is `export function mount(root, page, actions) { … }`. No default export, global registry, Node entry point or sidecar.
- The build checks that first line, not a substring anywhere, and **does not import or evaluate author JS**. A missing or unreadable file, an absent declaration, or a version other than numeric 1 stops the build with a nonzero exit, naming the path and the expected declaration; no output is overwritten and nothing is uploaded to a remote. A module or handle that is invalid after a valid declaration is a viewer-time contract error (6.6), not something the version check proves.
- A contract change needs a new version number and a changelog entry (ADR 0003).
- No flag: the installed `skill/featherbi/assets/shell.js`. `build … --shell <file>`: that local path (relative to the invocation cwd, or absolute), **instead of**, not layered over, the default. No YAML key.
- In every mode (single file, `--offline`, split, remote) the build embeds the selected bytes as a base64 `data:text/javascript` module and imports it before starting the engine. No runtime `file:` sibling imports, no build-time bundling service. The default shell still uses its pinned CDN libraries; `--offline --shell` embeds those too. Split still needs HTTP for its snapshot and remote for its data links; neither needs a separate shell file.
- `#dashboard` JSON and existing CSS stay byte-for-byte; escaped header and initial-theme inputs go in separate bootstrap data, not new `#dashboard` fields. `filters.period` is non-enumerable at the base, so the build carries it explicitly, not from filter defaults. The frame keeps the title, CSS, import map, data and an empty mount root; no default navbar or dialog hides behind an alternate shell.

#### 6.3 `mount(root, page, actions)` inputs

`root` is the connected, empty frame `HTMLElement`; the shell owns the chrome in it. Inputs are read-only plain values; strings are **text**, `null` means absent. All members are required unless marked nullable. `page`:

```text
title: string; logo: embedded image URL | null; subtitle, headerLine: string | null
canToggleTheme: boolean; hasDate: boolean; exploreTable: string | null
dimensions: [{name, options: Value[]}]   // config order; Value = the original non-null option, not a DOM string coercion
layout: 'flat' | 'stack' | 'tabs'
groups: [{title: string | null, tiles: [{type, title, note: string | null, hasSpark: boolean}]}]
```

`type` is `kpi|echarts|pivot|table|text`. Flat has one untitled group. Groups and tiles are in config order, so a shell can place KPIs in the top row without changing handle order. `headerLine` is the final locale-formatted status/period/source text. No source paths, SQL, signed URLs, engine or library objects reach a shell.

**`actions`** (shell → renderer, user gestures only; all return `undefined`):

| Action | Effect |
|---|---|
| `dim(name, valueOrNull)` | Set an exact supplied option, or clear it (All, chip ×). |
| `date('from'\|'to', isoDayOrNull)` | Change one date input; empty → null. |
| `reset()` | Restore global defaults, **not** tab 1. |
| `tab(n)` | Select a **1-based** tab, including keyboard navigation. |
| `theme(darkBoolean)` | Request a scheme. |
| `openExplore()`, `closeExplore()` | Include the modal Close and Escape paths. |

Core accepts only applicable dimensions and options, date inputs, schemes and in-range tabs; hash parsing stays in core. An action is never emitted in response to a setter.

#### 6.4 The view returned by `mount`

Setters return `undefined`, take effect synchronously and are safe to repeat. Only `alert` is an append notification. No promises, selectors, CSS-class protocol or required IDs.

| Member | Shell responsibility and data |
|---|---|
| `tiles: TileHandle[]` | One per tile in flattened **config order**, including text tiles and closed tabs. Constructed once; retained for the page lifetime. |
| `filters({dims, from, to})` | Paint labeled selectors, All, From/To if `hasDate`, active dimension chips and Reset. `dims` is a name→selected-value record; a missing name means All. `from`/`to` are input day strings or null. An unrepresentable date is left blank and is not a user change. The shell keeps no authoritative copy of filters. |
| `tab(n, focus)` | Tabs only. Show that panel, set selected state and roving tabindex; focus its tab only if `focus === true` (a user gesture, not hash restoration). The shell owns `tablist/tab/tabpanel` relations, wraparound arrows, Home/End. Stack shows titled sections; flat keeps today's two regions. |
| `theme(dark)` | Reflect the boolean on the control; hide the control when `!canToggleTheme`. Core sets the document scheme (`winter`/`night` root tokens) before first paint (system preference, or the sole allowed scheme), refreshes chart/grid theme and supplies the viewer theme without looking up a checkbox. No persistence. |
| `exploreHost: HTMLElement \| null`; `explore(phase)` | `exploreHost` is null if Explore is not configured, otherwise a stable, sized host **inside** the shell-owned dialog. Phases: `hidden` = no launcher or dialog visible (initial, expired); `closed` = launcher available, dialog closed; `loading` = modal open, launcher disabled, host laid out but old rows invisible; `open` = modal and fresh viewer visible. The shell supplies launcher, title, Close and keyboard/focus behavior and never creates Perspective. |
| `remote(until, progress)` | `until: string \| null` is the complete local-time "Data available until …" line; `progress: null \| {loaded, total}` in bytes. Null removes the corresponding UI. One main progress bar with max/value and `Loading data x / y MB` (bytes / 2²⁰, one decimal). Independent of the snapshot header line. |
| `alert(kind, message)` | `kind: 'error' \| 'warning'`; `message` is plain text. One accessible alert per notification, for engine, library, snapshot, download and Explore errors and the expiry warning. No raw exception, HTML or request URL. |

**`TileHandle` = `{host, update(patch)}`.** `host` is null for `kpi`; for every other type it is a stable `HTMLElement` whose **contents belong to the renderer**, sized by the shell (nonzero chart/grid dimensions when shown). It is never replaced or cleared on a patch or tab switch. The shell owns the card/group, heading, busy/skeleton, error and empty messages, KPI value/delta/sparkline/note and the table host. `update` returns `undefined`; keys missing from the patch leave previous values alone:

- `title: string` replaces the displayed heading (table row counts and the SQL cap text arrive preformatted).
- `busy: boolean` toggles loading and ARIA state.
- `empty: string | null` shows or clears the no-data text outside the host.
- `error: string | null` sets or clears the tile error. The default shell keeps today's main alert placement for tile failures; the renderer does not also emit a duplicate page alert.
- `kpi: {value: string, delta: string, points: string}` replaces all KPI result fields: already-formatted text, an empty delta if none, SVG polyline points in a `0 0 100 24` viewBox (empty = no line). A null or no-engine value shows `–`. The KPI `note` is plain text from the descriptor in `page`.

#### 6.5 Order, failures and shared state

1. Import, check `manifest.shell === 1` and `mount`, parse the initial hash, mount once before any SQL. Check the required handles and their count; never silently mix shells.
2. Initial theme and tab are reflected synchronously; cards start loading except static text. Engine, snapshot and library work stays async in the renderer. Tabs and hash work during startup. Set `filters` when today's controls become ready and start the current open group(s). On gestures, cross-filter clicks or `hashchange`, core applies the **one** state, reflects it, mirrors the hash with the existing rules and runs open groups only. Only current results or errors may patch; queued work for a now-closed tab does not start. A setter never starts a query, and no shell promise can race a later paint.
3. Remote clock expiry or 403: remove until/progress, hide Explore, keep filters and layout, show the existing expiry warning and run **no tile SQL**. During download, update aggregate bytes; on completion remove progress and retain `until` if valid. Other failures name the table and status and let unaffected tiles render. Core decides; the shell presents.
4. Enable a configured Explore after the initial refresh unless expired. On open: capture the current filters, show `loading`, lazily load or reuse Perspective, load or replace the filtered Arrow rows in its viewer in `exploreHost`, flush and resize, then `open`. An ordinary filter refresh never pushes new rows into an open viewer. Close hides and does not destroy the host; a late completion cannot reopen a closed dialog or paint over a newer open. Re-entry while loading is not a second load. On failure: close, alert, release busy state; the next open can retry. No Perspective download before the first open.

#### 6.6 Contract errors

If import, `mount` or the handle check fails, the renderer stops that render and shows a shell-specific diagnostic as text on the **bootstrap root**; there is no second UI and no fallback shell. There is no teardown API for a one-document dashboard. The build, not the shell, chooses assets.

#### 6.7 Constraints from SP1

[SP1](../research/2026-11-26-web-components-shell-spike.md) supports a single base64 module, not arbitrary libraries: Chromium refused relative `file:` ESM, and `new URL(relative, import.meta.url)` in a data module failed in both engines. A shell therefore inlines its JS, CSS, fonts/icons and assets, with no external imports, autoloaders, lazy chunks or default fetched icon sets. The tested Shoelace select/tabs/dialog are feasibility evidence, **not a dependency** and no certification of other components, Safari or CSP.

#### 6.8 Plain-shell wiring (illustration, excerpts inside the named `mount`; not a second shipped shell)

```js
// Native select: first option is All, then dimension.options in order.
select.onchange = () => actions.dim(dimension.name,
  select.selectedIndex === 0 ? null : dimension.options[select.selectedIndex - 1]);
from.onchange = () => actions.date('from', from.value || null);
launcher.onclick = () => actions.openExplore();
// One handle for a plain KPI card's result <div>:
const revenue = { host: null, update(p) {
  if (p.kpi) valueDiv.textContent = p.kpi.value;
  if ('busy' in p) card.setAttribute('aria-busy', String(p.busy));
} };
// For a chart/table return its own sized <div> as host; for Explore return
// a different <div> in the dialog as exploreHost. No chart/grid/viewer import here.
```

`references/shell.md` documents this exact interface (6.1–6.7).

## Non-goals

- Range selection (brush) as a filter, multi-select per dimension, and loading data in the viewer's browser at run time. They change spec 0001 rules and ADR 0001 and get their own specs or ADRs.
- Sorting, filtering or paging of `sql` tables in SQL; per-column formats in tables; CSV export.
- A shell key in `dashboard.yaml`, shells for specific companies or brands in this repository, theme engine work beyond spec 0003.
- Nested sections, per-section filters, or dragging tiles.
- Translating the page's own UI strings (button labels such as "Reset"); `locale` changes formats only.

## Acceptance examples

Fixture: the hand fixture (`fixtures/hand`, 12 sales rows, oracle values in its README).

1. **Default unchanged (same rendered page).** For every existing fixture config (default shell, no new keys), built before and after the change: the embedded dashboard data (the `#dashboard` JSON) and the CSS are byte-identical (except that a comparison whose reference predates #108's default-colour contrast change, owner decision 2026-11-27, allows those colour values to differ; see spec 0003), and after load in Chromium the page's accessibility tree under `header` and `main` (roles, names, texts) is identical. Planned deliberate differences are listed in the plan task that makes them (for example table number formats, §2) and excluded from that comparison only for the elements they name. Byte-identical HTML is not required: the renderer and template are embedded, so any renderer change alters the bytes.
2. **SQL table.** A `table` tile with `sql: SELECT region, SUM(revenue) AS revenue FROM sales WHERE {{filters:sales}} GROUP BY 1 ORDER BY 1` shows 2 rows, EU 850.00 and US 1,410.50; after selecting channel Online it shows EU 360.00 and US 660.00. With `click: region`, clicking the EU row sets region = EU: the Revenue KPI shows 850.00.
3. **Row cap.** A `sql` table over a 1 001-row result shows 1 000 rows and "first 1 000 rows"; over a 1 000-row result it shows all 1 000 and no note.
4. **Locale.** With `locale: de-DE`, the hand fixture's Revenue KPI with `format: {style: currency, currency: EUR}` shows `2.260,50 €`; a KPI with `format: {decimals: 1, unit: t}` and value 1234.5 shows `1.234,5 t`; `format: percent` with value 0.25 shows `25 %`; the table date column shows `05.01.2025` for 2025-01-05.
5. **KPI note.** A KPI with `note: "Sum of revenue, net"` shows that line under the value; the same KPI without `note` is unchanged.
6. **Header line.** The hand fixture with `date` and `source_label: Sales export` shows `Data as of 03/25/2025 · Period 01/05/2025 – 03/25/2025 · Source Sales export` (no `locale`, so `en-US`), and the page contains no source path. With `locale: de-DE` it shows `Data as of 25.03.2025 · Period 05.01.2025 – 25.03.2025 · Source Sales export`.
7. **Tabs.** A config with two sections and `layout: tabs`: on load only the first tab's tiles have queried; selecting region EU in the filter bar, then opening tab 2, shows EU values there. The URL hash is `#region=EU&tab=2`; opening it in a fresh tab opens tab 2 with EU. Arrow keys switch tabs. Checked in Chrome and Firefox, 0 console errors.
8. **Stack.** The same config with `layout: stack` shows both section titles and all tiles; values equal acceptance 7.
9. **Shell.**
   - Default: for every fixture config including `sections.yaml`, the `#dashboard` JSON and CSS are byte-identical to the base, and the settled Chromium `header`/`main` accessibility trees are identical with no exclusions (for tabs, wait for the visible pass to settle on both pages).
   - Alternate: `build fixtures/hand/acceptance.yaml --shell tests/fixtures/plain-shell.js`; the output file opened in Chromium and Firefox, with the alternate chrome identified by its own accessible UI, gives hand README values (spec 0001 acceptance 1): Revenue `$2,260.50`; clicking EU in the revenue bar → `$850.00`, 6 sales rows, EU × February `$300.00`, hash `#region=EU`; Explore shows 6 EU rows; after close and From/To `2025-02-01`/`2025-02-28` → `$300.00`, reopened Explore → 2 rows; Reset → `$2,260.50`. Real widgets are driven, not exported methods.
   - Same alternate with `--offline`, local shell source unavailable to the viewer and non-file network blocked: the same result, zero network attempts or errors.
   - A missing file, no declaration, or `shell: 2` stops the build nonzero with no new HTML and no replacement.
10. **Errors.** Each build rejection listed in §1, §2 and §5 stops the build with an error naming the tile (and section), and no HTML is written.

## Capture checkpoint

- **Vocabulary:** adds **section** (a titled group of tiles), **layout** (`stack` or `tabs`), **shell** (the module that renders the page chrome) and **header line** to CONTEXT.md on approval.
- **Decisions:** a replaceable shell is a new extension point; it is an architectural choice (costly to reverse once a derived edition depends on it). **ADR 0003 "Replaceable page shell"**, accepted with this revision: the renderer keeps engine, filters, charts and grid; the shell owns chrome; the contract is versioned; no shell key in the config. It amends ADR 0001's "one generic renderer"; everything else stays within ADR 0001.
- **Behavior:** this spec.
- **Uncertainty:** none blocking. SP1 (merged) fixed the Web Components constraints in 6.7; the exact shell interface is fixed in §6 revision 3. Safari and CSP are untested and are a derived shell's responsibility.

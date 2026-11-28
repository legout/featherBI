# Shell contract v1

The **shell** is the browser module that renders a dashboard's page chrome: header, filter bar, sections or tabs, tile cards, KPI cards, remote progress, alerts and the Explore dialog. The renderer keeps everything else. `build --shell <file>` replaces the default shell (`assets/shell.js`, DaisyUI markup) for one build. This file is the public interface of contract version 1 (spec 0005 §6 r3, ADR 0003).

Most dashboards never need this. Change colours, fonts and the logo with `theme:` (`references/themes.md`); write a shell only when the page needs another component library.

## Roles

- **Renderer** (core): engine, snapshot, SQL, filter state, URL hash, number and date formats, ECharts, both AG Grid models (paging, sorting, row and keyboard clicks), the pivot's result table with its row-link clicks, safe Markdown content, Perspective.
- **Shell**: all chrome. Header (title, logo left of the title, subtitle, header line, theme control, icons), filter bar (labelled selectors, All, From/To, chips, Reset), section/tab container, cards, headings, busy/skeleton, error and empty messages, KPI value/delta/sparkline/note, table host, remote progress, the Explore launcher and dialog.
- The renderer may fill a host it was given and theme a library instance in it. It never reads, queries or changes a shell control, card, heading or dialog. A shell never runs a query.
- A shell is trusted code that runs in the viewer's page; it is **not** sandboxed.

## File format and selection

- One UTF-8, self-contained browser ES module. Its **first line**, after an optional BOM and without its LF or CRLF, is exactly:

  ```js
  export const manifest = { shell: 1 };
  ```

  Its other required named export is `export function mount(root, page, actions) { … }`. No default export, global registry, Node entry point or sidecar file.
- The build checks that first line only. It does not import or run the file. A missing or unreadable file, a first line that is not the declaration, or another version stops the build with a nonzero exit that names the path and the expected declaration. No output is written or replaced, nothing is uploaded.
- No flag: the installed `assets/shell.js`. `build … --shell <file>`: that file (relative to the cwd, or absolute) **instead of** the default. There is no `dashboard.yaml` key; one config builds with any shell.
- Every mode (single file, `--offline`, `--split`, `--remote`) embeds the shell's bytes as a base64 `data:text/javascript` module. The page imports it before the engine starts; the original file is not needed when the page is opened.
- A contract change gets a new version number and a CHANGELOG entry. The build rejects a version it does not support.

## SP1 constraints (Web Components and `file://`)

The shell is one base64 data module, so it cannot load anything relative to itself: Chromium refuses relative `file:` module imports, and `new URL(relative, import.meta.url)` fails inside a data module in Chromium and Firefox. A shell therefore **inlines** its JS, CSS, fonts, icons and other assets: no external imports, no component autoloaders, no lazy chunks, no default icon sets fetched at run time. A shell that loads from the network does not work with `--offline`. Shoelace select, tabs and dialog worked in the spike (`project/research/2026-11-26-web-components-shell-spike.md`); that is feasibility evidence, not a dependency and no certification of other components, Safari or CSP. A derived shell owns its accessibility, `file://` and `--offline` behaviour.

## `mount(root, page, actions)`

Called once per page, synchronously, before any tile SQL runs. Returns the **view** (below).

### `root`

The connected, empty frame `HTMLElement`. The shell builds its chrome inside it.

### `page`

Read-only plain values. Strings are **text**, never HTML. `null` means absent. Every member is present.

| Member | Type | Meaning |
|---|---|---|
| `title` | string | The dashboard title. |
| `logo` | string \| null | The theme's logo as an embedded image URL (`data:`). |
| `subtitle` | string \| null | The config's `subtitle`. |
| `headerLine` | string \| null | The final, locale-formatted status/period/source line, e.g. `Data as of 03/25/2025 · Period 01/05/2025 – 03/25/2025 · Source Sales export`. |
| `canToggleTheme` | boolean | False when the theme has only one scheme: hide the theme control. |
| `hasDate` | boolean | The config has a date filter: show From and To. |
| `exploreTable` | string \| null | The table Explore opens; null when Explore is off. |
| `dimensions` | `[{name, options}]` | In config order. `options` are the original non-null option values (strings, numbers or booleans), not their DOM string forms. |
| `layout` | `'flat'` \| `'stack'` \| `'tabs'` | `flat` without sections. |
| `groups` | `[{title, tiles}]` | In config order. `flat` has one group with `title: null`. Each tile is `{type, title, note, hasSpark}`: `type` is `kpi`, `echarts`, `pivot`, `table` or `text`; `title` a string; `note` a string or null (KPI note); `hasSpark` true when a KPI has a sparkline. |

No source paths, SQL, signed URLs, engine or library objects reach a shell.

### `actions`

The shell calls these for **user gestures only**, never in response to a setter. Each returns `undefined`. The renderer ignores a call it cannot apply (an undeclared dimension, a value that is not one of its options, a tab out of range).

| Action | Effect |
|---|---|
| `dim(name, valueOrNull)` | Select one of `dimensions[].options` exactly as given, or clear the dimension with `null` (All, chip ×). |
| `date('from' \| 'to', isoDayOrNull)` | Change one date input (`YYYY-MM-DD`); an empty input is `null`. |
| `reset()` | Restore the global filter defaults. The open tab stays. |
| `tab(n)` | Open tab `n`, **1-based**; also for keyboard navigation. |
| `theme(dark)` | Ask for the dark (`true`) or light (`false`) scheme. |
| `openExplore()` | The launcher was used. |
| `closeExplore()` | Close, including the dialog's Escape (`cancel`) path. |

## The view

The object `mount` returns. Setters return `undefined`, take effect synchronously and are safe to call again with the same values. Only `alert` appends. No promises, selectors, CSS-class protocol or required IDs.

| Member | Shell responsibility |
|---|---|
| `tiles: TileHandle[]` | One per tile in flattened config order (all groups, text tiles and closed tabs included). Built once, kept for the page's lifetime. |
| `filters({dims, from, to})` | Paint the selectors (All first, then the options), From/To when `hasDate`, a chip with a clear button per active dimension, and Reset. `dims` maps a dimension name to its selected value; a missing name is All. `from`/`to` are `YYYY-MM-DD` or null; show a value the input cannot represent as blank without reporting a change. Keep no authoritative copy of the filters. First called when the filter bar is ready (after the engine started), then after every change. |
| `tab(n, focus)` | `tabs` only. Show panel `n` (1-based), mark its tab selected, roving `tabindex`. Move focus to the tab only when `focus === true` (a user gesture, not a hash restore). The shell owns `tablist`/`tab`/`tabpanel`, wrap-around arrow keys, Home and End. `stack` shows titled sections; `flat` the page's usual regions. |
| `theme(dark)` | Reflect the scheme on the theme control; hide the control when `!canToggleTheme`. The renderer sets the document scheme itself (`data-theme` `winter`/`night` on the root element, before first paint: the system preference, or a one-scheme theme's scheme) and re-themes charts, grids and the viewer. Nothing is saved. |
| `exploreHost: HTMLElement \| null` | Null when `exploreTable` is null; otherwise a stable, sized element **inside** the shell's dialog. The renderer puts Perspective's viewer in it. |
| `explore(phase)` | `hidden`: no launcher, no dialog (initially, and when the data link has expired). `closed`: launcher available, dialog closed. `loading`: dialog open (modal), launcher disabled, host laid out but its old rows invisible. `open`: dialog open, fresh rows visible. The shell supplies launcher, title, Close and keyboard/focus behaviour; it never creates Perspective. |
| `remote(until, progress)` | `until`: the complete local-time line `Data available until …`, or null. `progress`: `{loaded, total}` in bytes, or null. Null removes that UI. One progress bar (`max`/`value`) labelled `Loading data x / y MB` (bytes / 2²⁰, one decimal). |
| `alert(kind, message)` | `kind` is `'error'` or `'warning'`; `message` is plain text. Show one accessible alert (`role=alert`) per call: engine, library, snapshot, download and Explore errors, and the expiry warning. |

### `TileHandle = {host, update(patch)}`

- `host` is `null` for `kpi`. For every other type it is a stable `HTMLElement` whose **contents belong to the renderer** (chart canvas, grid, pivot table, Markdown). The shell sizes it (a chart or grid host needs a nonzero width and height when shown) and never replaces or clears it on a patch or tab switch.
- `update(patch)` returns `undefined`. A key missing from the patch leaves its previous value:
  - `title: string` replaces the heading (a table's row count and the SQL cap arrive preformatted).
  - `busy: boolean` loading state and `aria-busy`. Every tile but `text` starts busy.
  - `empty: string | null` shows or clears the no-data text, outside the host.
  - `error: string | null` sets or clears the tile's error. The default shell shows it as an alert at the top of the page, as before; the renderer does not also send a page alert.
  - `kpi: {value, delta, points}` replaces all KPI results: `value` and `delta` are formatted text (`–` for no value, an empty delta when there is none); `points` is an SVG polyline `points` string in a `0 0 100 24` viewBox, empty for no line. The KPI's `note` comes from `page`.

## Order and failures

1. The page imports the shell, checks `manifest.shell === 1` and `mount`, reads the URL hash and mounts once, before any SQL. It then checks the view: every setter is a function, one handle per tile, a host element for every non-KPI tile, an `exploreHost` when Explore is on.
2. The initial scheme and tab are reflected at once (`theme`, `tab(n, false)`, `explore('hidden')`); cards start busy. Engine, snapshot and libraries load in the background. Tabs and the hash work during startup. On every gesture, cross-filter click or `hashchange` the renderer applies the one filter state, calls `filters`/`tab`, writes the hash and runs the open group(s) only. Only current results patch a tile; a setter never starts a query.
3. Remote data (`--remote`): `remote(until, progress)` while downloading, `remote(until, null)` when done. On an expired link (viewer clock, or a 403): `remote(null, null)`, `alert('warning', …)`, Explore stays `hidden`, filters and layout stay, no tile runs SQL. Another failed table: an alert naming the table and status; unaffected tiles still render.
4. Explore: `closed` after the first refresh (unless expired). An open captures the current filters, shows `loading`, loads Perspective on the first open only, loads the filtered rows into the viewer in `exploreHost`, then shows `open`. A filter change never touches an open viewer. Close hides the dialog and keeps the host. A late result never reopens a closed dialog or replaces a newer open; an open while one is loading is ignored. On failure: `closed`, an alert, and the next open tries again.

**Contract errors.** If the import, `mount` or the view check fails, the page stops and shows `featherBI: this page's shell does not meet shell contract v1 (…)` as text in `root`. There is no fallback shell and no teardown API.

## Minimal example

```js
export const manifest = { shell: 1 };

export function mount(root, page, actions) {
  const add = (tag, parent, text) => parent.appendChild(Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }));
  const header = add("header", root);
  add("h1", header, page.title);
  const main = add("main", root);
  const tiles = page.groups.flatMap(group => group.tiles).map(tile => {
    const card = add("div", main);
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", tile.title);
    const title = add("h2", card, tile.title);
    const value = tile.type === "kpi" ? add("div", card) : null;
    const host = value ? null : Object.assign(add("div", card), { style: "height:320px" });
    return { host, update(p) {
      if ("title" in p) title.textContent = p.title;
      if ("busy" in p) card.setAttribute("aria-busy", String(p.busy));
      if (p.kpi) value.textContent = p.kpi.value;
    } };
  });
  return { tiles, exploreHost: null, filters() {}, tab() {}, theme() {}, explore() {}, remote() {}, alert(kind, message) { add("p", main, message).setAttribute("role", "alert"); } };
}
```

A complete plain-DOM shell with selectors, dates, chips, tabs, Explore and remote progress is `tests/fixtures/plain-shell.js` in the featherBI repository.

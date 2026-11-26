# Spike: can a Web Components page chrome run from `file://` and offline?

Date: 2026-11-26. Task SP1 of [plan 0005](../plans/2026-11-26-0005-tables-locale-sections-shell.md), issue #120, epic #119. Throwaway probe in `/tmp/wcspike`; nothing from it is committed. This note records what a scout observed (reports on issue #120) and where that stops.

## Question

Can a page chrome built from one Web Components library, loaded as one ESM bundle, run from a double-clicked file and from a single file with every non-`file:` request blocked, in Chrome and Firefox? What breaks: custom-element registration from `data:` URLs, `import.meta.url` asset lookups, runtime-fetched fonts/icons, CSP?

## Method

- One HTML page opened with Playwright from `file://`. The component JS is a **base64 `data:text/javascript` module** (`<script type="module" src="data:...">`).
- **Probe 1, stand-ins:** hand-written custom elements `wc-select`, `wc-tabs`, `wc-dialog` (native `<dialog>`, `showModal()`), plus `wc-badge` (shadow DOM). Not a real library.
- **Probe 2, real library:** Shoelace `@shoelace-style/shoelace` **2.20.1**, bundled with esbuild **0.28.2** (`--bundle --format=esm --minify`) to one 165 KB ESM file from `dist/components/{select,option,tab-group,tab,tab-panel,dialog,button,icon}.js`. The `light.css` theme is inlined as a `data:text/css` link. Page: `file:///tmp/wcspike/page/shoelace.html`.
- **Network block:** a Playwright context route that aborts every non-`file:` request. Chrome was also run with the `--offline` launch flag (identical results).
- **Browsers:** Playwright's Chromium (the Chrome engine) and Playwright's Firefox. Playwright, Chromium and Firefox version numbers were not recorded by the scout.
- Interaction: Playwright; the select, tab and dialog checks were driven with in-page clicks and state reads.

## Results

Same cells in both probes unless noted. ✅ = worked as expected, ❌ = failed. "Chrome blocked" = route block; "Chrome `--offline`" = route block plus the launch flag. Firefox was run with the route block only.

### Components (Probe 2, Shoelace 2.20.1)

| Check | Chrome, `file://`, blocked | Chrome, `file://`, `--offline` | Firefox, `file://`, blocked |
|---|---|---|---|
| Page loads; `sl-select`, `sl-tab-group`, `sl-dialog`, `sl-button`, `sl-icon` register | ✅ | ✅ | ✅ |
| **select**: open, choose "Beta" → value and `sl-change` = `b` | ✅ | ✅ | ✅ |
| **tabs**: click tab 2 → tab active, panel 2 shown | ✅ | ✅ | ✅ |
| **dialog**: `show()` opens, footer button closes | ✅ | ✅ | ✅ |
| Non-`file:` requests attempted | 0 | 0 | 0 |
| Page/JS errors | none | none | none |

### Components (Probe 1, stand-ins)

| Check | Chrome, blocked | Chrome, `--offline` | Firefox, blocked |
|---|---|---|---|
| Elements register from the `data:` module | ✅ | ✅ | ✅ |
| `wc-badge` shadow DOM renders | ✅ | ✅ | ✅ |
| select: value change | ✅ | ✅ | ✅ |
| tabs: panel switch, `aria-selected` | ✅ | ✅ | ✅ |
| dialog: `showModal()` open/close | ✅ | ✅ | ✅ |

### Platform behavior (Probe 1)

| Check | Chrome, blocked | Chrome, `--offline` | Firefox, blocked |
|---|---|---|---|
| `new URL(rel, import.meta.url)` inside the `data:` module | ❌ `Invalid URL` | ❌ same | ❌ same |
| runtime `fetch()` of an https font | ❌ blocked | ❌ blocked | ❌ NetworkError |
| relative `file://` ESM import (`./extra.mjs`) | ❌ CORS: origin `null`, scheme not supported | not run | ✅ works |

Not run: Firefox with any launch-level offline setting (only the route block), and no mode where the network was really cut at OS level. The "`--offline`" column for Chrome is the same route block with one more flag; the scout did not verify that the flag changes anything.

Shoelace made zero non-`file:` requests even when the network was *not* blocked: the icons used by the select, tab group and dialog are inlined SVG in JS. This only covers the components tested.

## Constraints a shell must meet (for `references/shell.md` in C5)

1. **One HTML file; no relative module files.** Chrome refuses `<script type="module" src="./x.mjs">` from `file://` (origin `null`); Firefox allows it. Inline all JS into the file or as `data:` module URLs.
2. **`data:` modules have no base URL.** `import.meta.url` is opaque, so anything that resolves assets relative to it fails. Keep styles and icons in JS strings, or inject a base path.
3. **No runtime network fetches.** Fonts, icons and CSS must be embedded. A `fetch()` from origin `null` fails offline, and was CORS-blocked even in the CORS test of Probe 1.
4. **Shoelace, if chosen:** works pre-bundled to one ESM file for select, tabs and dialog. `sl-icon name="…"` with the default icon library `fetch()`es an SVG via `getAssetPath()` (derived from `import.meta.url`), so it would break from a `data:` module; use system icons or inline SVG. (This is the scout's reading of the library; the default-icon case was **not** driven in a test.) The CDN autoloader fetches chunks lazily and cannot work offline.
5. **Inline the theme CSS** (`data:text/css` or `<style>`). esbuild ignores bare `.css` imports by default, so the bundle step must resolve them.
6. **Shadow DOM works in both browsers.** Test automation must pierce shadow roots; Playwright `selectOption` on a custom element failed in Probe 1.
7. Native `<dialog>`, select and tab patterns behaved the same in Chromium and Firefox from `file://` when fully inlined.

## Limitations

- The network block is a Playwright route abort (plus the Chromium `--offline` flag), not an OS-level firewall or airplane-mode test.
- Playwright's Chromium and Firefox builds, not the installed Google Chrome, Snap Chromium or a system Firefox, and not a double-click from a file manager. Safari and others not tested.
- Only the Shoelace components named above. Other components, Web Awesome, and Material Web were not tested; they may fetch assets.
- Not tested: `localStorage`/`sessionStorage` on `file://` (partitioning differs per browser), CSP (no headers exist on `file://`; a `<meta>` CSP was not tried), fonts via `@font-face` with `data:` sources.
- Interaction was scripted; one early probe timed out on a tab click because an open select dropdown covered the tabs, and one probe reported `eventFired:false` because it had no listener. Both were probe errors, fixed in later runs, not component failures.

## Verdict

For the tested set (select, tabs, dialog), a Shoelace 2.20.1 shell bundled to one ESM file and inlined into a single HTML file ran from `file://` with non-`file:` requests blocked in Playwright Chromium and Firefox, and nothing failed. §6 is feasible under the constraints above. The unresolved risks are the untested items under Limitations, not an observed failure.

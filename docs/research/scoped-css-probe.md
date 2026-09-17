# Scoped trusted CSS probe

## Question and threshold

Can trusted author CSS be parsed and scoped under one dashboard root while preserving useful CSS, rejecting network-loading constructs, and leaving third-party shadow internals to supported customization seams?

Acceptance required exact valid transforms and invalid rejections for ordinary selectors, custom properties, keyframes, useful at-rules, imports, remote/data/blob URLs, shadow boundaries, AG Grid variables, and Perspective variables/parts. CSS must not be described as a complete security sandbox.

## Environment and exact versions

- macOS 26.6.2 (25G83), arm64
- Node.js 26.8.2
- `postcss 8.5.6`
- `postcss-prefix-selector 2.1.1`

Primary sources are PostCSS's [parser/API documentation](https://postcss.org/api/), the prefixer's [documented transform hook and keyframe handling](https://github.com/RadValentin/postcss-prefix-selector), AG Grid's [CSS variables/theming API](https://www.ag-grid.com/javascript-data-grid/theming-parameters/), and Perspective's pinned [theme variables](https://github.com/finos/perspective/tree/v3.8.0/rust/perspective-viewer/src/themes).

## Reproducible command and transform shape

The isolated script parsed with PostCSS before modifying anything. It walked the AST to reject unsafe constructs, then ran the prefix plugin with `#dashboard` and a small transform hook:

```sh
node css/run.mjs
printf '%s' '.card { color: red }' | node css/scope.mjs
```

The policy was deliberately strict:

- allow only `@media`, `@supports`, `@layer`, `@keyframes`, `@-webkit-keyframes`, `@property`, `@container`, and locally sourced `@font-face`;
- always reject `@import`, `@document`, `@namespace`, and unknown at-rules;
- decode CSS escapes and remove comments before checking names/values;
- reject HTTP(S), protocol-relative, `data:`, and `blob:` tokens;
- reject every non-fragment `url(...)`, including relative URLs;
- reject `image-set(...)`, `behavior`, `-moz-binding`, `/deep/`, `>>>`, and `::shadow`; and
- permit fragment-only references such as `url(#shadow)`.

`:root`, `html`, and `body` become `#dashboard`; already rooted selectors stay unchanged; other selectors receive `#dashboard`.

## Observed transform

Input:

```css
:root { --brand: #246; }
.card, .kpi:hover { color: var(--brand); background: linear-gradient(#fff, #eee); }
@media (width >= 48rem) { .grid { display: grid; } }
@supports (display: subgrid) { .grid { grid-template-columns: subgrid; } }
@layer dashboard {
  .ag-theme-quartz { --ag-accent-color: var(--brand); }
  perspective-viewer { --plugin--background: white; --d3fc-series: var(--brand); }
}
.icon { filter: url(#shadow); }
@keyframes pulse { from { opacity: .5; } to { opacity: 1; } }
.badge { animation: pulse 1s; }
```

Output:

```css
#dashboard { --brand: #246; }
#dashboard .card, #dashboard .kpi:hover { color: var(--brand); background: linear-gradient(#fff, #eee); }
@media (width >= 48rem) { #dashboard .grid { display: grid; } }
@supports (display: subgrid) { #dashboard .grid { grid-template-columns: subgrid; } }
@layer dashboard {
  #dashboard .ag-theme-quartz { --ag-accent-color: var(--brand); }
  #dashboard perspective-viewer { --plugin--background: white; --d3fc-series: var(--brand); }
}
#dashboard .icon { filter: url(#shadow); }
@keyframes pulse { from { opacity: .5; } to { opacity: 1; } }
#dashboard .badge { animation: pulse 1s; }
```

PostCSS preserved custom properties, gradients, media/supports/layer blocks, keyframe selectors, and animation references. It prefixed selectors nested in useful at-rules but did not prefix `from`/`to` inside keyframes.

## Observed rejections

Every invalid case exited through a PostCSS node error:

| Case | Result |
|---|---|
| `@import "https://…"` | rejected: `@import is not allowed` |
| HTTP(S), protocol-relative, data, or blob value | rejected: network-loading value |
| escaped `u\72l(https\3a //…)` | rejected after escape normalization |
| comment-obfuscated `u/**/rl(https://…)` | rejected after comment removal |
| relative `url(./tracking.png)` | rejected: non-fragment URL |
| string-form `@namespace` URL | rejected: `@namespace is not allowed` |
| string-form `image-set("./one.png" 1x, …)` | rejected: network-loading value |
| `-moz-binding: url(…)` | rejected property |
| `/deep/` selector | rejected shadow-piercing selector |
| unknown future at-rule | rejected by the allowlist |

## Shadow DOM, component themes, and CSP

The transform receives only author `theme.css`; it never opens or rewrites a third-party shadow stylesheet. Ordinary selectors stop at a shadow boundary. AG Grid is customized on its documented theme element with `--ag-*` variables. Perspective is customized on `<perspective-viewer>` with its exposed theme variables; a `::part(...)` selector can be scoped in the same way only when that installed component version actually documents the part. The probe does not invent a part name or treat private shadow markup as API.

The strict no-URL policy means transformed CSS requires no additional `img-src`, `font-src`, or `connect-src` network source. The final artifact still needs a CSP hash/nonce or a build-time inline-style policy. CSP is defense in depth, not a replacement for rejecting author CSS that violates the approved boundary.

## Limitations and rejected approaches

- Keyframe names are preserved, not namespaced. A trusted author can collide with a renderer's global keyframe name. Issue #6 may add deterministic keyframe/reference renaming if a real collision appears; it is not needed to prove root scoping.
- Selector scoping does not stop trusted CSS from hiding or restyling dashboard-owned status/error/accessibility affordances inside the root. The compiler still needs a small semantic denylist or post-build browser assertions for required UI.
- The policy rejects relative images and web fonts even when they might be packageable. This is an intentional first-version boundary; asset packaging can be specified later instead of smuggling URL semantics into this probe.
- CSS syntax, layout cost, browser bugs, visited-link behavior, overlays, and deceptive presentation are outside a selector prefixer's guarantees. This is constrained trusted author code, not hostile-code isolation.
- Regex alone was rejected. The accepted shape parses an AST first and normalizes CSS escapes/comments before the narrow value checks. A production implementation should keep fixture checks for new CSS syntax when the allowlist changes.
- Rewriting third-party shadow internals, using deprecated shadow-piercing combinators, and globally prefixing raw text were rejected.

## Verdict: PASS

PostCSS plus the small pinned prefix plugin meets the approved trusted-author boundary when preceded by strict AST validation and a default-deny at-rule/URL policy. It scopes ordinary selectors without damaging keyframes or supported component variables.

## Consequence for issue #6 and specification

Issue #6 can implement this two-stage seam: parse/validate first, prefix second, then test that required status/error UI remains visible. Keep AG Grid and Perspective customization on documented variables and actual exposed parts. No change to [runtime v2 §6.3](../specs/dashboard-project-and-runtime-v2.md#63-theme) is indicated.

## Cleanup

The temporary npm package, parser script, valid/invalid fixtures, transformed CSS, and logs were deleted after evidence was recorded. No dependency, stylesheet, or generated output is tracked.

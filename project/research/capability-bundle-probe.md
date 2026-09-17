# Capability-built deterministic bundle probe

## Question and threshold

Can generated imports produce deterministic viewers containing only selected ECharts, AG Grid Community, Perspective, CodeMirror SQL, daisyUI/Tailwind, and Siemens iX capabilities, with explicit JS/CSS/WASM/worker consequences under `file://`?

Acceptance required at least a basic and expanded build, repeated-build hashes, asset sizes, module/license boundaries, and evidence distinguishing esbuild tree-shaking from generated-import or copied-asset selection.

## Environment and exact versions

- macOS 26.6.2 (25G83), arm64
- Node.js 26.8.2; npm 11.19.1; esbuild 0.28.2

| Capability | Pinned package | Version | License |
|---|---|---:|---|
| charts | `echarts` | 6.1.0 | Apache-2.0 |
| default grid | `ag-grid-community` | 35.3.1 | MIT |
| exploration | four `@finos/perspective*` packages | 3.8.0 | Apache-2.0 |
| SQL editor | `@codemirror/state` 6.5.2, `@codemirror/view` 6.38.6, `@codemirror/lang-sql` 6.10.0 | as shown | MIT |
| generated utility/theme CSS | `tailwindcss` and `@tailwindcss/cli` | 4.3.3 | MIT |
| component theme | `daisyui` | 5.2.1 | MIT |
| industrial theme | `@siemens/ix` | 5.2.1 | MIT |
| industrial grid adapter | `@siemens/ix-aggrid` | 5.1.0 | MIT |

Primary sources: esbuild's [tree-shaking](https://esbuild.github.io/api/#tree-shaking) and [metafile](https://esbuild.github.io/api/#metafile) documentation; ECharts' [tree-shaking API](https://echarts.apache.org/handbook/en/basics/import/); AG Grid's [module documentation](https://www.ag-grid.com/javascript-data-grid/modules/), [Community/Enterprise boundary](https://www.ag-grid.com/javascript-data-grid/community-vs-enterprise/), and [license page](https://www.ag-grid.com/license-pricing/); CodeMirror's [modular system guide](https://codemirror.net/docs/guide/); Tailwind's [source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files); daisyUI's [Tailwind plugin setup](https://daisyui.com/docs/install/); and the Siemens iX [AG Grid guide](https://ix.siemens.io/docs/components/grid/guide).

## Reproducible commands and generated entries

All packages and outputs lived in an isolated temporary npm package. Four generated entries were built twice into clean directories:

- `basic`: `echarts/core` plus `BarChart`, `GridComponent`, `TooltipComponent`, `CanvasRenderer`; AG Grid `createGrid`, `ModuleRegistry`, and `ClientSideRowModelModule`.
- `explore`: basic plus Perspective viewer/datagrid/D3FC registration, its three WASM binaries, and CodeMirror state/view/SQL.
- `daisy`: basic plus CSS generated from Tailwind with the daisyUI plugin and an explicit `btn card table input select` source list.
- `siemens`: basic plus `defineCustomElements`, `getIxTheme`, Siemens iX core/light CSS, and AG Grid Community.

```sh
npx @tailwindcss/cli -i bundles/daisy-input.css \
  -o bundles/daisy.css --minify

npx esbuild bundles/VARIANT.js --bundle --minify --format=iife \
  --platform=browser --target=chrome120 \
  --outfile=bundles/OUT/VARIANT/viewer.js \
  --metafile=bundles/OUT/VARIANT/meta.json --legal-comments=eof \
  --loader:.wasm=file --loader:.html=text \
  --loader:.woff=file --loader:.woff2=file --loader:.ttf=file \
  --asset-names=assets/[name]-[hash]

# Repeated for OUT=out-a and OUT=out-b.
shasum -a 256 bundles/out-{a,b}/VARIANT/*
```

A second `explore-inline` build changed only `--loader:.wasm=binary`, matching the file-safe initialization shape exercised by the [Perspective probe](perspective-file-probe.md).

## Observed composition and determinism

Every corresponding output in the two clean builds had the same SHA-256 hash.

| Variant/output | Bytes | SHA-256 |
|---|---:|---|
| basic `viewer.js` | 1,099,358 | `54ce4761af4817dbff2b41a1f6e3b091c28d0bb62077dc552502a3cbca3d1adc` |
| explore `viewer.js` | 1,890,909 | `aea7f17c7a855d63acfd76e94de00c60e6b2ea59e89c94b7b47cc9ff786259ad` |
| explore `viewer.css` | 9,588 | `27541334488fee108e4c6846436f651bb91d08210590e01934ea7d4a8b8e8b7c` |
| Perspective client WASM | 217,046 | `d2e839e744cf559b042b68c6643066a087d5a5f03c5b47c58b6095d2aaa15d1f` |
| Perspective server WASM | 2,277,909 | `166f95b940b28e9508fc156501cc55ad7944c9e903229ef3ff1614daadad8a1b` |
| Perspective viewer WASM | 920,705 | `19a299297ca7fc5047486f6ca51aa29b2f969e3ebf50ba16627901ead85fe81a` |
| explore-inline `viewer.js` | 6,445,399 | `591582e91564a91ecfee650f7d3a1085554b2922b3cb60c38fd75419e6937f08` |
| daisy `viewer.js` | 1,099,384 | `2ef95a445e157fffcbf0a8094acb860b9cb74658ced32a3b61cfd8f51748a967` |
| daisy `viewer.css` | 47,412 | `84269dcac49311e8135221de6b28aa36aa4f1b13cf0cbe2ae82749c59c815ba2` |
| Siemens `viewer.js` | 3,281,462 | `ea70f17a79ae02a9ba1c98065294f27ab61bee9a640fce04b22afda621d1340a` |
| Siemens `viewer.css` | 164,321 | `7afec9f18d7b44e8d82a7615d6c1f08de6e35b92242b03d8908de9e494f94cbc` |

Total output sizes were 1,099,358 bytes basic; 5,316,157 bytes explore with separate WASM; 6,454,987 bytes explore-inline; 1,146,796 bytes daisy; and 3,445,783 bytes Siemens.

The esbuild metafiles showed:

- basic included ECharts and AG Grid Community, but no FINOS, CodeMirror, daisyUI, or Siemens module input;
- explore added FINOS and CodeMirror but no daisyUI or Siemens input;
- Siemens added Siemens packages but no FINOS, CodeMirror, or daisyUI input;
- only ECharts bar implementation files contributed bytes to the basic output; line, pie, sankey, and treemap implementation files contributed zero bytes despite being reachable through ECharts barrel modules;
- no `ag-grid-enterprise` package or module was installed or emitted; and
- daisyUI selection happened before esbuild: Tailwind emitted only the explicitly sourced component/utility CSS. The CSS contained the daisyUI 5.2.1 marker and selected `.btn` rules, while the metafile correctly saw generated CSS rather than the daisyUI JavaScript package.

No worker file was emitted for Perspective because its worker bootstrap was bundled into JavaScript. Separate Perspective WASM assets are deterministic, but sibling `file://` fetching is not a safe startup assumption; the inline-WASM variant trades three requests for a 6.45 MB JS payload. Generated HTML should inline or hash CSS/JS consistently with the final CSP.

## Limitations and rejected approaches

- `@siemens/ix-aggrid 5.1.0` declares peer support for AG Grid 33, 34, or 35. Installing current AG Grid 36.2.0 failed dependency resolution, so the valid matrix pins 35.3.1. Issue #7 must resolve and record peers before building, not silently use `--force`.
- `@siemens/ix-aggrid` supplies theme helpers; it does not turn Enterprise modules into Community features. Enterprise remains out of contract.
- esbuild tree-shakes JavaScript exports, not product intent. Generated entries are still required to select the chart, grid modules, editor, Perspective plugins, and theme. A universal entry with runtime flags would retain too much code.
- Tailwind/daisyUI needs a deterministic prebuild with explicit source candidates. esbuild alone cannot infer desired utility classes or prune a precompiled theme by project semantics.
- CSS, WASM, fonts, icons, and worker scripts require an explicit asset policy. Tree shaking does not make copied assets reachable under `file://`.
- Hash equality was demonstrated on one machine/toolchain with clean output directories. Production determinism also requires normalized HTML/build metadata, stable source ordering, pinned transitive resolution, and no absolute paths or timestamps.
- The basic JavaScript remains about 1.10 MB before transfer compression. Size budgets and minified-versus-compressed reporting belong in issue #7.

## Verdict: PASS

Generated imports plus esbuild tree shaking and a deterministic Tailwind prebuild can produce capability-specific, repeatable bundles. Non-JavaScript assets and Perspective's file-safe initialization must be explicit build-manifest entries rather than assumed side effects.

## Consequence for issue #7 and specification

Issue #7 should implement a small capability registry that generates imports, pins compatible package/peer versions, records selected capabilities and asset hashes, and chooses inline versus copied assets based on the proven `file://` startup path. It must fail an unsupported AG Grid/iX peer combination before building. Earlier compiler/runtime slices must not preclude this capability-specific build boundary. This supports, rather than changes, [ADR 0006](../adr/0006-compile-dashboard-projects-into-typed-viewers.md) and the [runtime-v2 capability-build contract](../specs/dashboard-project-and-runtime-v2.md#10-capability-built-viewer).

## Cleanup

The temporary `package.json`, lock, `node_modules`, generated entries, Tailwind input/output, two build trees, metafiles, WASM, CSS, JS, and logs were deleted after recording evidence. No dependency or generated output is tracked.

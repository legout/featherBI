# Plan 05 — Packaging and agent skill

> **Archived:** superseded by [`../mvp.md`](../mvp.md). Keep for historical evidence only; do not execute this decomposition.

Status: approved by the owner and pending integrated Plans 02–04 plus supervised candidate/integration approvals.

- **Approval reference:** owner message on 2026-09-07: “plans look good. approved”.
- **Approved revision and scope:** `742330bb95b1a19c9ab26a33029b9a75ac470633`; RC-01/RC-06/RC-09/RC-10/RC-11 and AP-06 authoring, packaging, reopening, and skill-handoff scope described below.
- **Capture checkpoint:** [runtime contract §10](../../specs/runtime-contract-v1.md#10-planning-handoff), reconciled at `0d166f322ed6724ce14437fee278a542d506206b`; vocabulary is in [`CONTEXT.md`](../../../CONTEXT.md), architectural constraints are in ADR-0001 through ADR-0004, and no material capture decision remains unresolved.
- **Planning contract/provenance:** contract version 1; installed `write-implementation-plan` hash `fbad63d3b33b854f78d5d93b91bc0b756448a819f877010649fe453455689609`; installed `planning-contract` hash `671e9bf465ecf63e4030882f5e848c33aa028d271949a89a2ce776af0c89c271`.

## Goal, dependencies, and sources

Deliver the complete agent → dashboard → share flow using one deterministic packager and the same browser runtime for authoring preflight and recipients.

Prerequisites: [Plan 04](04-grid-and-ap-dashboard.md), plus shared validator/controller interfaces from Plans 01–03. Sources: [runtime contract](../../specs/runtime-contract-v1.md) §8 and RC-09/RC-11; [AP scenario](../../specs/ap-inspection-dashboard.md), especially AP-06. Map: RC-01/RC-06 authoring parity → P5.1; RC-09/AP-06 → P5.2/P5.3; RC-11 → P5.4; RC-10 final reopened-artifact integration → P5.3.

No upload/deployment endpoint, viewer-side editor/re-export, registry publication, release, or skill installation is included. Recipients need only desktop Chrome; authors need Node/npm and installed Chrome for browser-backed validation. This reuses the proven WASM path rather than adding a second native DuckDB implementation with potentially different import semantics.

## Planned CLI surface

These commands do not exist yet; they are the exact interface to implement:

```sh
node bin/featherbi.mjs schema
node bin/featherbi.mjs validate --config examples/ap-dashboard.config.json --source ap=/path/to/ap_unified.parquet
node bin/featherbi.mjs build --config examples/ap-dashboard.config.json --source ap=/path/to/ap_unified.parquet --mode bundle --out /path/to/dashboard.zip
node bin/featherbi.mjs build --config examples/ap-dashboard.config.json --source ap=/path/to/ap_unified.parquet --mode embedded --out /path/to/dashboard.html
```

`schema` prints the authoritative contract JSON Schema without launching Chrome or writing files, so a separately loaded skill does not need a duplicate schema. `--source` repeats for multiple declared IDs. Input paths remain CLI-local. Upload-mode inputs require all source assignments; embedded-mode inputs can use existing content, with explicit mapped replacements taking precedence. Unknown/duplicate IDs and missing mappings fail. `build` requires explicit `--mode` and `--out`; there is no implicit overwrite, deploy, or mode change. Existing output is an error unless `--overwrite` is supplied. `validate` writes no distributable.

## P5.1 — CLI and browser-backed preflight

**Prerequisites:** P4.1/P4.2. **Obligation:** `new-test` — authoring must validate actual data and queries, not only a JSON shell.

**Create:** `bin/featherbi.mjs`, `packager/preflight.mjs`, `packager/preflight-browser.mjs`, `tests/unit/cli.test.mjs`, `tests/browser/preflight.spec.mjs`. **Modify:** `package.json`, `package-lock.json`, `scripts/build.mjs`.

**Consumed interfaces:** shared `validateConfig`, viewer/engine/controller runtime, source maps, and bounded result envelopes. **Produced interface:** `preflight(config, sourceMap)` → validated, bounded result summary or rejection; no output artifact on failure. The CLI launches the same engine/controller through a temporary authoring page. It does not maintain separate normalization or SQL-admission logic.

- [ ] Add `playwright-core` 1.63.0 as the explicit authoring runtime dependency; it uses installed Chrome, not a downloaded fallback browser. Keep the existing test package on the same version.
- [ ] RED: CLI option errors, source-ID mapping errors, structural config failure, invalid late data row, invalid authored SQL, wrong result binding, missing Chrome, denied network asset, and successful two-source preflight.
- [ ] Bundle `packager/preflight-browser.mjs` as `build/preflight.js` alongside the viewer. Its temporary page exposes only the fixed preflight entry point, not a generic host filesystem/RPC bridge. Assign File inputs through Playwright using sourceMap; never interpolate paths into the exported config or send file bytes over an application HTTP endpoint.
- [ ] Preflight invokes controller loading, complete source validation, SQL admission/defaults/bounded visible queries, and binding checks. Report validator issue paths or source/query IDs, never a dump of source rows or environment credentials.
- [ ] Own the isolated browser/context/temp directory with `try/finally`. Permission/policy failures are actionable nonzero failures, not reasons to disable browser security, skip preflight, or substitute another execution path.
- [ ] GREEN: `node --test tests/unit/cli.test.mjs`; `npm run build && npm run build:harness && npx --no-install playwright test tests/browser/preflight.spec.mjs --project=chrome`; `node bin/featherbi.mjs validate --config tests/fixtures/runtime.config.json --source inspections=.artifacts/fixtures/inspections.parquet --source products=.artifacts/fixtures/products.parquet`.

**Completion evidence:** CLI and viewer accept/reject the same cases through shared code. Successful validation exits zero; a data/schema/query/browser failure exits nonzero and leaves no distributable. The installed-Chrome authoring prerequisite is documented, not hidden behind a native-engine substitute.

## P5.2 — Safe deterministic HTML and ZIP construction

**Prerequisites:** P5.1. **Obligation:** `new-test` — output escaping, path safety, and failure atomicity protect data and artifact integrity.

**Create:** `packager/build.mjs`, `tests/unit/packager.test.mjs`. **Modify:** `bin/featherbi.mjs`, `package.json`, `package-lock.json`, `shells/grid.html` only at documented template insertion points.

**Consumed interfaces:** successful `preflight`, validated config/source maps, viewer build output, and the pinned runtime-asset manifest. **Produced interface:** `buildArtifact({config, sourceMap, mode, outputPath, overwrite})` preflights first, then returns a receipt `{path, mode, bytes, contract, runtimeVersions}` only after final publication to the requested local path. It does not mutate the input config/files.

- [ ] Add pinned `fflate` 0.8.3 for ZIP construction; do not handwrite a ZIP implementation. Use Node's filesystem/streams for ordinary IO.
- [ ] RED: both packaging modes, output already exists, source-basename collisions, missing data, malicious path hints, `</script>`/Unicode text in config, partial-write failure, and deterministic repeat output from identical synthetic inputs.
- [ ] Build a derived output config: upload mode plus bundled files for ZIP; embedded mode plus Base64 bytes for HTML. Revalidate the derived structure. Remove superseded content when changing modes. Runtime-generated handles, schema names, absolute paths, and sourceMap never enter it.
- [ ] Use deterministic root-level ZIP member names derived from source IDs and safe basename hints, fixed ordering/timestamps, and collision checks. Include `dashboard.html` and the accompanying data; do not embed a second copy of ZIP data in the HTML. Stream large data members with backpressure; already-compressed Parquet can be stored without recompression.
- [ ] Safely serialize config/data and inline the fixed viewer JS/CSS. Labels/data containing markup remain inert. External runtime dependencies come only from the pinned build manifest; no unversioned dependency URLs or build timestamps that unnecessarily defeat deterministic output.
- [ ] Preflight can be a distinct pass from byte emission. If an input changes/disappears while building, fail rather than produce a knowingly inconsistent package; compare available file identity/size/mtime before and after emission. This is change detection, not a claim of locking arbitrary local files against all races.
- [ ] Write a sibling temporary output, finish/close it, then rename into place under the explicit overwrite policy. Failure removes the owned partial output and preserves an existing destination. Refuse symlink destinations instead of following them into an unintended overwrite. Handle cleanup errors visibly; do not report success before final rename.
- [ ] GREEN: `npm run build && node --test tests/unit/packager.test.mjs`; then `npm run check && npm run test:browser`.

**Completion evidence:** safe member names and serialization, identical-input reproducibility, bounded ZIP streaming, overwrite protection, and failure-atomic output. No arbitrary token detector is claimed: the tool never imports credentials/host environment automatically, and the author remains responsible for intentional config/data content.

## P5.3 — Reopen produced artifacts and verify parity

**Prerequisites:** P5.2. **Obligation:** `new-test` — a packager exit code does not prove that its file opens correctly.

**Create:** `tests/browser/artifacts.spec.mjs`. **Modify:** `tests/browser/ap-private.spec.mjs` for the optional full-file packaged checks under the existing explicit private gate.

**Consumed interfaces:** the CLI, `buildArtifact`, viewer, synthetic fixtures, and optional private AP gate. **Produced evidence:** reopened embedded/ZIP parity, security, replacement, and boot-failure evidence for RC-09/AP-06; no new product interface.

- [ ] RED: produce synthetic embedded HTML and ZIP through the actual CLI, extract ZIP to a fresh temp directory, and navigate each resulting HTML via file:// in an isolated Chrome context. Assign required files to source IDs through the visible picker controls.
- [ ] Assert identical normalized aggregates, chart bindings, filter behavior, source-replacement rollback, and successful corrected replacement. Test malicious-looking labels/cells/embedded strings remain text and cannot execute script. Check requested URLs against the fixed runtime-asset manifest; no viewer data/telemetry request should appear.
- [ ] Deny a required runtime asset in a fresh context and verify useful boot error/retry behavior, not an empty page or a warm-cache false pass. Verify published HTML has no test-harness/preflight host hooks.
- [ ] Test missing/ambiguous assignments and filename mismatch without silent auto-binding. A same-schema replacement with a different basename is accepted after explicit mapping; changing a file on disk alone does not auto-refresh the artifact.
- [ ] Private AP packaging uses an OS temporary directory outside the repository for any full data copy. Reopen the actual bundle and verify AP-02/AP-03 values; clean up copies afterward. Never Base64-embed the full AP file just to prove small-artifact parity and never copy it into committed or ignored project fixtures.
- [ ] GREEN: `npm run build && npm run build:harness && npx --no-install playwright test tests/browser/artifacts.spec.mjs --project=chrome`; then `FEATHERBI_AP_PATH=/Users/volker/data/ewn/ap_unified.parquet npm run test:ap` for private reopening evidence.

**Completion evidence:** AP-06/RC-09 pass on produced artifacts, not merely the development harness. Record Chrome versions and save bounded screenshots/results. Automation proves the file:// context and file-input route; a final ordinary manual open/selection check remains part of release/handoff evidence rather than being mislabeled as already exercised by Playwright.

## P5.4 — Authoring skill and user handoff

**Prerequisites:** P5.3. **Obligation:** `existing-check` — documentation/skill examples are validated by the implemented CLI and browser gates; no new framework or speculative agent evaluator.

**Create:** `skill/featherbi/SKILL.md`, `skill/featherbi/catalog_schema.sql`, `skill/featherbi/examples/kpi-and-trend.config.json`, `skill/featherbi/examples/join-and-table.config.json`, `README.md`, `tests/unit/skill-examples.test.mjs`. **Modify:** `tests/browser/preflight.spec.mjs` to preflight the static examples against their declared synthetic source maps. Existing `check` already discovers the new unit test; no redundant package script is needed.

**Consumed interfaces:** CLI `schema`/`validate`/`build`, the shared contract, synthetic fixtures, and reopened-artifact gates. **Produced interfaces:** the `featherbi` authoring skill, checked examples/catalog, and recipient/author README handoff.

- [ ] Read the available skill-authoring guidance before writing `skill/featherbi/SKILL.md`. Use the name `featherbi`, matching its leaf directory. Reference bundled examples/DDL relative to the skill directory and obtain the live schema through the CLI's `schema` command. Use an available `featherbi` command or an explicitly supplied checkout's `node bin/featherbi.mjs`; if neither exists, request the tool path rather than inventing an absolute installation path.
- [ ] Teach the agent to inspect schema/sample data, establish metric grain and units, emit contract JSON, run `validate`, and invoke deterministic `build`. Do not ask it to write custom HTML, invent failure/yield meanings, embed credentials, or treat `LIMIT 1` as full validation.
- [ ] `catalog_schema.sql` documents the AP fields and only the approved metric definitions. Unknown M*/E* meanings remain absent, not guessed. Source IDs and exclusive table query IDs follow the runtime contract.
- [ ] Few-shot examples demonstrate KPI/chart sharing, a date filter, a two-source join, and a dedicated table query. Validate them against the shared schema and actual synthetic data; assert that no private paths or real dataset rows appear.
- [ ] README documents Node/Chrome author prerequisites, `npm ci`/build commands, both packaging commands, receiver unzip/open/select steps, compatible replacement, online dependencies, trust limits, and error troubleshooting. Do not claim offline operation, Edge support, RLS, deployment, or publication.
- [ ] Run one two-source coding-agent authoring exercise using only the skill plus synthetic fixture/schema context; require source IDs `inspections` and `products`. Save generated config at `.artifacts/authoring/generated.config.json`; require CLI validation and both package modes with explicit source maps. Preserve the prompt/output and command receipts locally; successful static examples alone are not evidence that the authoring instructions were followed.
- [ ] Verify `npm run check && npm run build && npm run test:browser`; run `node bin/featherbi.mjs validate --config .artifacts/authoring/generated.config.json --source inspections=.artifacts/fixtures/inspections.parquet --source products=.artifacts/fixtures/products.parquet`, then run the two explicit build checks below (the overwrite targets are owned test artifacts).

```sh
node bin/featherbi.mjs build --config .artifacts/authoring/generated.config.json --source inspections=.artifacts/fixtures/inspections.parquet --source products=.artifacts/fixtures/products.parquet --mode bundle --out .artifacts/authoring/generated.zip --overwrite
node bin/featherbi.mjs build --config .artifacts/authoring/generated.config.json --source inspections=.artifacts/fixtures/inspections.parquet --source products=.artifacts/fixtures/products.parquet --mode embedded --out .artifacts/authoring/generated.html --overwrite
```

**Completion evidence:** generated and checked-in examples validate and reopen; the authoring exercise produces executable artifacts; recipients need neither Node nor an agent; no installation/publication occurred as a side effect of writing the skill.

## Final validation and handoff

From a clean, approved execution checkout:

```sh
npm ci
npm run check
npm run build
npm run test:browser
FEATHERBI_AP_PATH=/Users/volker/data/ewn/ap_unified.parquet npm run test:ap
```

Map final evidence to RC-01 through RC-11 and AP-01 through AP-07. Explicitly report normal-suite exclusion of private tests, manual OS open/drop coverage, and any unmeasured performance or cleanup behavior. All five plan gates must be complete before claiming the first release implemented.

Review the final diff, run same-surface verification, and obtain the orchestrator's candidate/integration approvals. These plans do not authorize pushing, merging a PR, publishing a package, installing the new skill, or releasing; those retain separate owner gates.

# Plan 01 — Contract and fixtures

Status: approved by the owner. Execution remains subject to the baseline-commit gate below and supervised candidate/integration approvals.

## Goal and sources

Create the shared config validator and reproducible synthetic data that subsequent plans consume.

- [Runtime contract](../specs/runtime-contract-v1.md): §§3–4, §§6–9; RC-01, RC-02, RC-06, RC-09.
- [AP scenario](../specs/ap-inspection-dashboard.md): metric semantics and baseline.
- [Browser evidence](../research/browser-feasibility-report.md): selected-file identity and the limits of existing proof.

Requirement map: RC-01 → P1.1/P1.2; RC-02 → P1.3 and Plan 02; RC-06 → P1.2 structural references and Plan 03 engine admission; RC-09 → P1.1/P1.2 structural safety and Plan 05 packaging tests. This plan does not claim to implement SQL admission, data conversion, or HTML safety by validating JSON alone.

## Shared execution assumptions

- One Node project, JavaScript ES modules (`.mjs`) and JSDoc at public boundaries; no frontend framework, TypeScript compiler, monorepo, or Python application runtime.
- Node 24+ and npm; the inspected environment has Node 26.8.1/npm 11.19.0. `uv` is used only for reproducible synthetic fixture generation, not by recipients.
- Pin direct dependencies and commit `package-lock.json` when committing is authorized. Available versions checked during planning: Ajv 8.20.0, esbuild 0.28.2, Playwright/Playwright Core 1.63.0, Siemens iX 5.2.1, iX icons 3.5.0. The browser probe used DuckDB-WASM 1.32.0 and ECharts 6.1.0. Introduce dependencies in the task that uses them, never silently upgrade a failed gate.
- Ajv schema compilation occurs at build time using standalone code generation. The browser imports the generated validator; no runtime `eval`/`new Function` schema compilation.
- No existing application, test suite, package manifest, or context glossary was found. Do not import `.pi` tooling into the application. Do not edit installed skills or create an ADR/glossary as incidental scaffolding.
- The repository has an unborn `main` and pre-existing untracked owner files. Before managed-worktree execution, the orchestrator must arrange an explicitly approved clean baseline commit with the owner. Do not `git add .`, erase owner files, create worktrees without a base, or switch execution protocols to evade this gate.

### Plan order and ownership

Default to one sequential writer: Plan 01 → Plan 02 → Plan 03 → Plan 04 → Plan 05. Dependency-defining schema, source lifecycle, and SQL-admission changes receive immediate review. A worker owns only the files listed by its task; the orchestrator owns candidate assembly, integration, and publication approvals. Do not create duplicate tracker tickets unless later coordination requires them.

Later plans reference this setup contract rather than redefining it. `package.json`, its lockfile, and `scripts/build.mjs` are shared write targets: only the current sequential writer edits them. No concurrent package installation/build-output mutation across tasks in one worktree.

## P1.1 — Build-time schema validator

**Prerequisites:** approved execution and baseline gate above. **Obligation:** `new-test` — malformed config must be rejected identically by authoring and browser code.

**Create:** `package.json`, `package-lock.json`, `.gitignore`, `contract/schema.json`, `contract/config.mjs`, `scripts/build-contract.mjs`, `tests/unit/config.test.mjs`, `tests/fixtures/minimal.config.json`.

**Interface:** `validateConfig(input)` returns `{ok: true, value: config}` or `{ok: false, issues: [{path, code, message}]}`; no thrown validation error and no mutation of input. Runtime exceptions remain exceptions, not validation successes. Generated implementation is `.generated/validate-config.mjs` and is not hand-edited or committed.

- [ ] Install Ajv 8.20.0 as a build dependency. Make the package private. Ignore `node_modules/`, `.generated/`, `build/`, `.artifacts/`, and Python caches; leave owner files and documentation tracking unchanged.
- [ ] Write tests first for the specification's minimal example, both delivery modes, every component/filter variant, nullable schema fields, and negative cases: unsupported versions/apps, unknown nested properties, missing required keys, invalid IDs, unsafe basenames, and wrong embedded-content shapes. Observe RED before creating the validator.
- [ ] Implement the JSON Schema and standalone generation; return compact path-aware issues. The same generated function is imported by future CLI and browser bundles.
- [ ] Define scripts: `generate:contract` = `node scripts/build-contract.mjs`; `test:unit` = `node --test tests/unit/*.test.mjs`; `check` = `npm run generate:contract && npm run test:unit`. Do not introduce scripts that report success when tests are absent or skipped.
- [ ] GREEN: `npm run generate:contract && node --test tests/unit/config.test.mjs`; then `npm run check`.

**Completion evidence:** positive configs accepted; each negative rejected with a stable code/path; generated runtime validator contains no executable-code compilation; source config is unchanged after validation.

## P1.2 — Semantic references and parameter namespace

**Prerequisites:** P1.1. **Obligation:** `new-test` — schema shape alone cannot prove references or binding consistency.

**Modify:** `contract/config.mjs`, `tests/unit/config.test.mjs`. **Create:** `tests/unit/config-references.test.mjs`.

**Interface consumed:** validated structural config. **Produced:** semantically validated config using the same `validateConfig` result envelope; no second externally divergent validator.

- [ ] RED: duplicate source/filter/component IDs, unknown query IDs, unknown source/column references, case-insensitively duplicate source columns, invalid filter/column type combinations, bad date bounds, unsupported defaults, and unknown query-parameter declarations.
- [ ] Expand date-range filter output names (`<id>_from`, `<id>_to`) and reject collisions with any other filter output. Reject duplicate parameter names within a query. SQL-placeholder discovery itself belongs to P3.1, not a regex added here.
- [ ] Validate binding shape by component kind and reject a table query ID referenced by another component (owner-approved clarification); actual query-result columns/types remain P3.2. Validate annotation dates and numeric display bounds. Preserve distinct null/empty-string defaults.
- [ ] Add own-property/prototype-pollution cases (`__proto__`, `constructor`) and quoted/unicode column names: dictionaries and references must not mutate prototypes or become SQL/HTML. Quote SQL later; do not silently sanitize a schema field into a different name.
- [ ] GREEN: `npm run generate:contract && node --test tests/unit/config-references.test.mjs`; then `npm run check`.

**Completion evidence:** all references resolve or yield an actionable issue before data access; generated parameter names cannot collide; schema and semantic errors use one public result shape.

## P1.3 — Reproducible parity, join, and boundary fixtures

**Prerequisites:** P1.1/P1.2. **Obligation:** `new-test` — subsequent loaders must compare against independently known data, not their own output.

**Create:** `tests/fixtures/rows.json`, `tests/fixtures/products.json`, `tests/fixtures/expected.json`, `tests/fixtures/runtime.config.json`, `tests/fixtures/generate.py`, `tests/unit/fixtures.test.mjs`. **Modify:** `package.json`.

**Interface:** canonical synthetic row/lookup JSON plus schema/config; generator emits `.artifacts/fixtures/inspections.csv`, `inspections.json`, `inspections.ndjson`, `inspections.parquet`, and `products.parquet`. Additional named negative/boundary fixtures are enumerated in `.artifacts/fixtures/manifest.json` with their source schema and expected outcome. `runtime.config.json` declares source IDs `inspections` and `products`, matching these CLI mappings. `expected.json` contains explicit normalized values, default-window metrics, join totals, and boundary expectations; it is not regenerated by the code under test.

- [ ] Write RED assertions against absent/generated fixtures and explicit expected values. Include five AP-shaped records (one just outside the default 30-date window), string identifier `001`, quoted empty string versus null, nullable boolean, missing product, and a lookup source with known join cardinality.
- [ ] Use inline script metadata pinning `duckdb==1.5.5` for the generator. The generation command is `uv run tests/fixtures/generate.py`; the npm `fixtures` script runs exactly that command.
- [ ] Generate additional bounded cases for all declared types: invalid calendar dates, timestamp microseconds/offsets, unsafe integers, malformed final rows beyond the reader's initial sample, duplicate/case-colliding headers, nested JSON, missing whole columns versus missing per-row keys, and valid empty datasets.
- [ ] Include a deterministic 10,001-row chart fixture and 205-row uniquely ordered table fixture. Do not copy any rows from the owner's AP file or require it for normal checks.
- [ ] Fail loudly if `uv`/DuckDB is unavailable; do not substitute missing Parquet fixtures with another format. Re-running generation replaces only its known synthetic outputs and converges.
- [ ] GREEN: `npm run fixtures && node --test tests/unit/fixtures.test.mjs`; then `npm run check`. Update `check` to run fixture generation before unit tests that require it.

**Completion evidence:** all four physical formats represent the same canonical rows; expected totals are independently checked; malformed/edge fixtures exist; no private data path or data bytes are required by the normal suite.

## Verification and handoff

Commands introduced by this plan, from repo root:

```sh
npm ci
npm run generate:contract
npm run fixtures
npm run test:unit
npm run check
```

All must exit zero with nonzero executed-test counts. These commands are planned interfaces, not commands that exist or have passed at planning time. A clean `npm ci`/generation/test run proves setup reproducibility; it does not prove browser runtime behavior.

Hand off schema, shared validator, fixtures, exact error envelope, and parameter namespace to [Plan 02](02-data-loading-and-replacement.md). Preserve residual risks: full-input validation cost, WASM SQL AST support, atomic staging/rollback, and packaging remain unimplemented. Before moving beyond P1.2, review the dependency-defining schema and semantic validator against RC-01 rather than accepting tests alone as specification coverage.

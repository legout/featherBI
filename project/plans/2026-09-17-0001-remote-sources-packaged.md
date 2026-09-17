# Remote sources — authoring and packaged delivery (issue #11)

**Status:** approved. Owner approved the plan on 2026-09-17 and directed commit + ticketization without implementation.

**Goal:** a dashboard project declaring a read-only remote source (`s3://` or `https://`) profiles bounded, compiles, and packages into the standard external-data ZIP with the recipient flow unchanged.

**Source:** [remote sources specification v1](../specs/remote-sources-v1.md) §§2–4, 6–7 (RS-01, RS-02); owner approval 2026-09-17 (design session + written review). Canonical task body: [issue #11](https://github.com/legout/featherBI/issues/11).

**Capture checkpoint (planning-contract v1):** vocabulary captured in `CONTEXT.md` (remote source, source delivery mode, authoring credential source); ADR 0007 accepted; behavior scope and non-goals in the specification; no unresolved owner decisions.

**Contract provenance:** planning-contract v1 and write-implementation-plan installed globally at `~/.pi/agent/skills/`.

**Constraints and non-goals:** credentials never in project files, generated state (except ignored `.env`/`.featherbi/`), configs, HTML, ZIPs, or logs; no external-network tests (localhost fixtures only); `delivery: live` is parsed in this slice but rejected with an actionable "lands with #12" error; viewer/runtime untouched; remote writes and presigned-URL issuing out of scope.

**Assumptions:** Node ≥24, `uv`, desktop Chrome; native DuckDB 1.5.5 (pinned) with `httpfs` for authoring-side reads; `.env` at repository or project root, manually parsed.

**Requirement map:** RS-01 → T2; RS-02 → T3; declaration acceptance → T1; credential hygiene → T2+T3; issue #11 checkboxes 1–4 → T1–T3; docs/README wiring → T4.

**Global validation:** `npm run check` (every code task); `npm run test:browser` unchanged-recipient-flow confirmation at T3 (existing artifacts flow covers it once packager output is verified equivalent).

## Tasks

### T1 — Remote declaration in schema and compiler

Files: `authoring/schema.json`, `authoring/compiler.mjs`, `tests/unit/project.test.mjs`.

- Source entries accept `remote: {uri, format, auth: none|s3, region?, endpoint?, filename?}`; `uri` restricted to `s3://`/`https://` schemes; `auth` enum; optional non-secret `region`/`endpoint`; optional `filename` (safe suggested ZIP basename, sanitized like existing local basenames).
- `delivery: packaged` is the default and only supported value; `live` fails compilation with the actionable "#12" error.
- Credentials or secret-looking keys anywhere in a remote declaration are rejected.
- Interfaces produced: compiler output marks remote sources for the packager (uri, format, filename) without emitting credentials.

Validation unit VU1 (`new-test`, normal risk): declaration compiles; unknown fields, bad schemes, `delivery: live`, and credential keys fail with precise location. Failure mode covered: invalid or leak-prone declarations silently accepted. Red: remote declaration rejected today → green after schema/compiler change. Command: `npm run check`.

### T2 — Remote profiling with authoring credentials

Files: `skill/featherbi/scripts/profile.py`, `.env.example` (new), `.gitignore`, `skill/featherbi/SKILL.md` (profile step only), `bin/featherbi.mjs` (allow URI in `--input`).

- `--input` accepts URIs; `httpfs` loaded for remote reads; format still explicit (`--format`).
- Credential resolution: `CREATE SECRET ... PROVIDER credential_chain` (aws extension) first; on unavailability or failure, explicit config-provider secret from `FTHR_S3_*` variables (documented in `.env.example`, manually parsed from `.env` at repo or project root; `.env` gitignored).
- Missing credentials → error naming the source ID and the required secret; profile output unchanged in shape and bounds: source-ID keyed, no URI, no credentials.

Validation unit VU2 (`new-test`, normal risk): localhost `httpfs` integration — Node `http` server serves a fixture Parquet, `featherbi profile --input http://127.0.0.1:…/x.parquet` returns the bounded profile with no URI inside; a second case with no credentials configured against a URI declared `auth: s3` produces the named-source/secret error. No external network. Failure mode covered: remote read path broken or leaking URIs/credentials. Command: `npm run check` (new unit file `tests/unit/remote-profile.test.mjs`).

Security note: remote URIs are author-trusted input on the author machine, equivalent to opening any local file; no recipient-facing surface in this slice.

### T3 — Build-time materialization into the ZIP

Files: `skill/featherbi/scripts/materialize.py` (new, uv-pinned like `profile.py`), `packager/build.mjs`, `packager/preflight.mjs`, `bin/featherbi.mjs`, `tests/unit/packager.test.mjs`, `README.md`.

- Build resolves each remote source: `materialize.py` fetches via `httpfs` (same credential resolution as T2) to a temp file; the packager then treats it exactly as an explicit local input (existing safe-member, atomic-publish, and no-partial-output rules apply unchanged).
- ZIP member name from `filename` or sanitized URI basename; runtime config/HTML carry no remote metadata.
- Materialization failure fails the build with source ID and cause; no partial ZIP (existing atomic publish preserved).
- README author section documents remote sources and `.env`.

Validation unit VU3 (`new-test`, normal risk): localhost end-to-end — project with one remote (`http://127.0.0.1`) and one local source → `featherbi build` → ZIP contains both members with safe names; error case (server 404) fails atomically naming the source. Failure mode covered: broken or non-atomic remote packaging. Commands: `npm run check`, then `npm run test:browser` (existing artifacts spec must stay green — recipient flow unchanged). Red: remote source unsupported today.

### T4 — Skill and reference wiring

Files: `skill/featherbi/SKILL.md`, `skill/featherbi/references/project-tracer.md`.

- Tracer documents: remote declaration example, credential setup (AWS chain → `.env`), profile/build commands with URIs, and the packaged-delivery default.

Validation unit VU4 (`no-new-test`, low risk): link and diff inspection only.

## Sequencing and review

T1 → T2 → T3 → T4, one sequential writer; T2 and T3 share the credential-resolution seam (T2 owns it, T3 consumes it). Review: one candidate review after T4 (normal risk, adaptive policy); VU1–VU3 focused checks are the evidence. One fix pass + one delta recheck maximum. Residual risk: real-bucket behavior (CORS variants, provider quirks) is exercised only by the owner's manual checks, since tests are localhost-only by design.

## Manual checks after integration

- Owner runs `profile` + `build` against one real private bucket (RS-06 style, authoring half), confirming credential-chain or `.env` works; no data, paths, or credentials committed.

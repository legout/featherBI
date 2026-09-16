# Dashboard project and runtime v2 plan

**Status:** approved. Owner approved the complete target specification and this five-ticket staged decomposition in the 2026-09-16 design session.

**Goal:** evolve featherBI from config-first MVP packaging into an agent-led, source-controlled dashboard-project workflow with bounded data understanding, progressive visual feedback, expanded typed analytics, and verified external-data delivery.

**Behavior source:** [dashboard project and runtime contract v2](../specs/dashboard-project-and-runtime-v2.md), owner-approved written revision dated 2026-09-16. Runtime v1 and the [AP scenario](../specs/ap-inspection-dashboard.md) define migration evidence, not the v2 target.

**Constraints:** [ADR 0005](../adr/0005-external-data-only-delivery.md) keeps data outside HTML; [ADR 0006](../adr/0006-compile-dashboard-projects-into-typed-viewers.md) owns the compiled project/fixed-viewer boundary; [CONTEXT.md](../../CONTEXT.md) owns vocabulary; [research evidence](../research/dashboard-authoring-and-ui-landscape.md) informs but does not authorize behavior.

**Capture checkpoint (planning-contract v1):** dashboard project, dashboard draft, data profile, metric, dimension, renderer preset, and SQL playground are defined in the glossary. ADR 0006 records the consequential compiler/query-engine/viewer decision and supersedes ADR 0002 for the target runtime. The v2 specification owns behavior and acceptance. Remote sources/cubes and the other named non-goals remain explicitly deferred. No material design decision is unresolved. Installed skill provenance is recorded in `skills-lock.json`.

## Execution

GitHub issues own canonical task bodies. This file owns only order, coverage, and integration boundaries.

Execute sequentially through `orchestrate-implementation` in supervised mode. Each issue leaves the repository coherent and green; a later issue cannot use its broader scope to hide unfinished behavior from an earlier slice.

1. [#4 — Prove dashboard authoring and viewer feasibility](https://github.com/legout/featherBI/issues/4) — ready; required evidence for profiling, Perspective/file://, capability bundles, and scoped CSS.
2. [#5 — Add dashboard project, profiler, compiler, and first draft tracer](https://github.com/legout/featherBI/issues/5) — blocked by #4; V2-01–V2-04 and V2-11 tracer.
3. [#6 — Build the responsive themed analytical runtime](https://github.com/legout/featherBI/issues/6) — blocked by #5; V2-05–V2-07 standard renderer.
4. [#7 — Add AG Grid, Perspective, and bounded SQL exploration](https://github.com/legout/featherBI/issues/7) — blocked by #6; V2-06/V2-08/V2-09 exploration boundary.
5. [#8 — Complete the authoring skill and migrate off runtime v1](https://github.com/legout/featherBI/issues/8) — blocked by #7; V2-02–V2-04/V2-10–V2-12 and final v1 removal.

## Requirement map

- Bounded profiling and confirmed relationships: #4 evidence, implemented in #5, completed/evaluated in #8.
- Editable project, compiler, manual edits, source hygiene: #5; final migration cleanup in #8.
- Models/metrics, layout, themes, typed filters/charts, interactions: #6.
- AG Grid, Perspective, playground, capability-built viewer: #7.
- Full progressive skill loop, AP migration, private acceptance, v1 removal, skill quality: #8.
- External-data ZIP and path/data secrecy: retained in every browser/package slice, final private proof in #8.

## Assurance and gates

- #4 is disposable feasibility work with `no-new-test` evidence and documentation inspection.
- #5 uses one focused compiler contract regression plus one end-to-end preview flow.
- #6 uses one coherent cross-filter browser scenario and focused schema/binding checks rather than a chart/theme matrix.
- #7 uses one playground-admission regression plus one exploration/capability browser flow.
- #8 uses skill evaluations, existing repository gates, stale-v1 search, and one private AP `no-new-test` acceptance.

Public contract, SQL admission, shared revision, and final v1-removal changes receive immediate review plus candidate review. Ordinary visual/skill work receives one candidate review. One fix pass and one delta recheck remain the limit.

Every code slice runs `npm run build`, `npm run check`, and `npm run test:browser`; focused commands live in the canonical issue. Private AP acceptance uses `/Users/volker/data/ewn/unified_ap.parquet` without committing paths, outputs, or data.

Candidate assembly, local integration, push, issue closure, publication, and release retain their explicit gates. A completed issue does not authorize starting its dependent issue unless its reviewed result is integrated into the next pinned base.

## Non-goals

This plan does not include remote S3/R2/GitHub data, Hyparquet cubes, hosted embedding, offline delivery, AG Grid Enterprise, custom plugins, arbitrary JavaScript/raw chart options, unrestricted CSS, recipient-persisted edits, automatic publication, or exhaustive component/theme combinations.

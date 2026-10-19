# Ticket execution order: issues #37–#54

**Status:** proposed scheduling map, 2026-10-19. Orders the approved tickets of [plan 0005](./2026-10-19-0005-static-sharing-and-live-refresh.md) (#37–#45) and [plan 0006](2026-10-19-0006-simplification-and-standard-theme.md) (#46–#54). The issues own the task bodies; this file owns only sequence and parallelism. Execution start, candidate assembly, integration, and push remain separate owner gates.

## Rules

- One writer per worktree. A lane is a worktree; lanes in the same wave touch disjoint files (table below).
- Waves integrate in order: a wave's lanes merge (sequentially, through the integration gate) before the next wave starts code that depends on them.
- Spikes write only `project/research/` evidence and disposable harnesses; they never block lanes that do not consume them.
- Owner decision points: G3 was approved after #38 for the exact artifact recorded in ADR 0009; the remaining owner decision is visual token approval inside #52.

## File ownership per ticket

| Ticket | Primary files |
| --- | --- |
| #37–#39 | `project/research/` only (disposable harnesses elsewhere) |
| #40 | `runtime/viewer.mjs`, `runtime/controller.mjs` |
| #41 | `skill/featherbi/scripts/export_delta.py` (new), `bin/featherbi.mjs`, `project-reference.md` |
| #42, #43 | `packager/*`, `scripts/build.mjs`, `bin/featherbi.mjs` |
| #44 | `runtime/sources.mjs`, `runtime/bootstrap.mjs`, `authoring/compiler.mjs`, schemas, fixtures |
| #45 | `README.md`, `SKILL.md`, `project-reference.md`, `CHANGELOG.md` |
| #46 | `skill/featherbi/scripts/profile.py` |
| #47 | `runtime/controller.mjs`, `runtime/capabilities/grid.mjs` |
| #48 | `runtime/viewer.mjs` |
| #49 | `profile.py`, `remote_common.py` imports, `project-reference.md`, skill references |
| #50 | `scripts/setup.mjs`, `bin/featherbi.mjs`, setup tests, README |
| #51 | skill references, README exploration sections |
| #52, #53 | `authoring/theme-tokens.mjs`, `authoring/compiler.mjs`, schemas, fixtures, skill interview |
| #54 | `AGENTS.md`, `skills-lock.json`, stale plan pointers |

## Waves

### Wave 1 — spikes and evidence (fully parallel, no shared files)

| Lane | Ticket | Why first |
| --- | --- | --- |
| 1a | #37 S1 | Gates the CSP shape for #42/#43. |
| 1b | #38 S2 | Gates #44 and produces the G3 decision basis. |
| 1c | #39 S3 | Gates #41. |

After #38: S2 passed and G3 was approved for the exact artifact recorded in ADR 0009. After #37: CSP shape recorded for #43.

### Wave 2 — quick wins and independent tracks (four lanes, disjoint files)

| Lane | Tickets (in order) | Files |
| --- | --- | --- |
| R (runtime) | #40 → #47 → #48 | viewer/controller/grid; #40 first because #42 depends on it; #48 is tiny |
| P (python/skill) | #46 → #41* → #49 | profile.py, export script, references; cleanup #49 last so it consolidates the final shape (*needs #39 from wave 1) |
| S (process/setup) | #54 → #50 → #51 | AGENTS.md/skills-lock, then setup, then exploration docs; lean process applies to everything after |
| T (theme) | #52 → #53 | theme/compiler/schemas/fixtures; #52 contains the owner's visual token review |

Conflict notes: #41 and #42/#43 both touch `bin/featherbi.mjs` — they sit in different lanes but different waves (see wave 3), so no concurrent edit. #40/#47/#48 are sequential inside lane R because they share viewer/controller.

### Wave 3 — static build chain (after #37 + #40 merged)

| Lane | Tickets (in order) | Files |
| --- | --- | --- |
| B (build) | #42 → #43 | packager, scripts/build.mjs, bin; #43 consumes the CSP shape from #37 and the target from #42 |

### Wave 4 — conditional and closing work

| Lane | Tickets | Condition |
| --- | --- | --- |
| D | #44 | #38 positive **and** G3 approved; runs when lane R and lane T are free (touches compiler/schemas like #52) |
| F | #45 | after #40–#43 merged; last because it rewrites README/SKILL that lanes P/S also edit |

### Critical path

#40 → #42 → #43 → #45 (runtime refresh → static target → CSP → docs/acceptance), with #39 → #41 feeding #45. Everything else has slack.

## Parallelism summary

- **Maximum useful concurrency:** 4 lanes (wave 2). More lanes only add integration overhead.
- **Never parallel:** #40 with #47/#48 (shared runtime files); #46/#41/#49 with each other (shared python/skill files); #44 with #52 (shared compiler/schemas); #45 with anything editing README/SKILL.
- **Always sequential per lane**, and every lane merges through the integration gate before dependents start.

## Validation per wave

Per ticket, run only its assigned focused validation obligation; runtime/browser tickets use their focused required browser scenario. Per owner direction (2026-10-19), defer aggregate `npm run check`, the full `npm run test:browser` suite, and assembled-wave validation until all #37–#54 tickets are implemented. Then run both suites on the assembled candidate. Spikes: evidence-note review only.

## Not decided here

Starting implementation (separate gate), push/release ordering, and any re-prioritization between waves 2 and 3 — lanes R and B cannot overlap, but wave 2's lanes P/S/T could also run alongside wave 3 if lane R is finished and files stay disjoint.

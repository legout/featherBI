# Implementation plan: simplification and standard theme

**Status:** approved by owner in chat on 2026-10-19 (G-A). Metric catalog stays opt-in (G-F resolved: keep). Managed `AGENTS.md` block removal approved (G-G). Standard theme: `vercel`, name and direction approved; visual token approval happens inside ticket #52 against `~/coding/libs/featherbi-mockups/shots/vercel.png`. Theme ticket #29 is closed, so G-E1 is satisfied. Ticketized in GitHub Issues #46–#54; the issues own the canonical task bodies. Candidate assembly, integration, push, and publication remain separate gates.

**Goal:** remove usability regressions and overbuilt surfaces that the basic path does not need. Keep the basic path unchanged. Make the standard theme `vercel`. Keep the process lean.

**Behavior sources:** owner decisions E3 to E7 in [ADR 0010](../adr/0010-owner-simplification-decisions.md), and ADR 0008 as amended for the standard theme. The amendments to the v2 specification (§3.3, §5, §6.3, §9, §11, V2-10), remote sources v1 (§4, §5), live-table specification (Delta), and theme specification (§2) are written in the repository and effective with this approval.

**Capture checkpoint:** vocabulary: no new terms beyond the plan 0005 additions in [CONTEXT.md](../../CONTEXT.md). Decisions: ADR 0010; ADR 0008 amended for the default. Behavior: amendments approved 2026-10-19. Uncertainty: none blocking.

## Gates

- **G-A** Approved 2026-10-19: owner approved this plan and the amendments.
- **G-E1** Satisfied: theme ticket #29 is closed and merged.
- **G-E2** Name approved: the standard theme is `vercel`. Visual token approval happens inside [#52](https://github.com/legout/featherBI/issues/52) (owner review against the mockup, not pixel equality).
- **G-F** Resolved 2026-10-19: the metric catalog stays as an opt-in feature. No task.
- **G-G** Approved 2026-10-19: remove the managed `pi-implementation-orchestrator` block from `AGENTS.md`.

## Tickets — canonical task bodies

Phase order: B quick wins, C setup, D opt-in docs, E theme, G process. Parallel across phases only where file targets do not overlap; one sequential writer otherwise.

| Ticket | Task | Phase | Blocked by |
| --- | --- | --- | --- |
| [#46](https://github.com/legout/featherBI/issues/46) | B1: Profiler emits featherBI types and a sources block | B | — |
| [#47](https://github.com/legout/featherBI/issues/47) | B2: Global table sorting and filtering | B | — |
| [#48](https://github.com/legout/featherBI/issues/48) | B3: Snapshot note only with a date-range filter | B | — |
| [#49](https://github.com/legout/featherBI/issues/49) | B4: Skill and script cleanup (duplicates, local-sources.yaml, rule owners) | B | — |
| [#50](https://github.com/legout/featherBI/issues/50) | C1: One setup path | C | — |
| [#51](https://github.com/legout/featherBI/issues/51) | D1: Exploration strictly opt-in in skill and docs | D | — |
| [#52](https://github.com/legout/featherBI/issues/52) | E1: Standard theme preset `vercel` and default switch | E | — |
| [#53](https://github.com/legout/featherBI/issues/53) | E2: Theme rollout — fixtures, browser specs, skill interview | E | #52 |
| [#54](https://github.com/legout/featherBI/issues/54) | G1: Lean process — AGENTS.md, managed block, stale pointers, skills-lock | G | — |

## Requirement-to-task map

| Requirement | Tickets |
| --- | --- |
| E3 opt-in exploration | #51 |
| E4 standard theme | #52, #53 |
| E5 SQL-first (catalog stays opt-in) | #51 |
| E6 one setup path | #50 |
| E7 lean process | #54 |
| Usability regressions | #46, #47, #48 |
| Overbuilt duplicates | #49 |

## Global validation

Per ticket, run only its assigned focused validation obligation; runtime/browser tickets use the focused browser scenario required by the ticket. Per owner direction (2026-10-19), defer aggregate `npm run check`, the full `npm run test:browser` suite, and assembled-candidate validation until all #37–#54 tickets are implemented. Then run both suites on the assembled candidate. Documentation edits: link and diff inspection.

## Residual risks

- The default-theme change alters how existing dashboards look; changelog entry and visual check in #52/#53.
- Moving sort into the query changes the table query path; #47 covers it.
- Removing the managed `AGENTS.md` block can be reverted by a setup rerun; documented in #54.

## Not in this plan

Delta and DuckLake ([plan 0005](./2026-10-19-0005-static-sharing-and-live-refresh.md)). Removing Perspective or the playground (E3 keeps them opt-in). Removing the metric catalog (G-F: keep). Deleting the legacy `neutral`, `daisyui`, or Siemens string themes — a separate decision after E4 lands.

Contract provenance: planning-contract v1. Installed skill revision: `unknown`.

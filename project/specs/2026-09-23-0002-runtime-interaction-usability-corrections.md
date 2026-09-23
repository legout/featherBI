# Runtime interaction and usability corrections

**Status:** Approved. The owner approved the complete in-chat design on 2026-09-23 and approved this written revision in the following conversation turn (both responses: “approved”). The approved scope is direct chart/Perspective selection, pending filter edits, option-search errors, the boolean control, safe-subset Markdown, Arrow result handling, a measure-first large-file probe, shared secret-parameter validation, and correction of stale agent-document paths. No implementation, integration, or publication was approved.

**Authority:** This document refines [dashboard project and runtime v2](dashboard-project-and-runtime-v2.md), especially §§7–9 and V2-06–V2-08. It does not replace that specification, [remote sources v1](remote-sources-v1.md), [ADR 0006](../adr/0006-compile-dashboard-projects-into-typed-viewers.md), or [ADR 0007](../adr/0007-remote-sources-and-recipient-credentials.md). [CONTEXT.md](../../CONTEXT.md) defines pending filter edits and filter revisions. Where this document adds detail, the earlier behavior and trust limits still apply.

## 1. Selection and filter-state behavior

The viewer retains the existing shared filter revision and one DuckDB-owned source/query lifecycle. ECharts, Perspective, AG Grid, and accessible chart-summary controls feed one typed selection path rather than maintaining separate filter logic. Rendering a chart alone must not be presented as cross-filter support: clicking a selectable mark in the chart itself must invoke that path.

A component may declare an optional `selectionDimensions` mapping from **result field name to dimension ID** for fields it emits. This is source-controlled project data carried into the strict runtime config; it is not an executable callback. The existing single `interactionDimension` continues to work for a component's primary emitted field, and existing projects remain valid. An explicit mapping may cover multiple Perspective group/split fields or chart category/series fields. The compiler rejects IDs absent from the project's dimension catalog; the compiler and runtime validator reject mappings to fields the component cannot emit and conflicts between explicit and existing bindings. A dimension with no shared filter is a valid local-only binding. A mapping updates shared filters only when exactly one compatible filter owns that dimension and the emitted value has the filter's declared type. No field-name inference from another source, label, or formatted display value is allowed.

A mark containing several compatible, mapped dimension/value pairs updates them **atomically in one filter revision**. Different dimensions combine with AND; existing multi-select replace, modifier-add/remove, and active-value-clear rules apply per dimension. Duplicate or contradictory values for one dimension, missing values, unsupported selection shapes, and unmapped/ambiguous fields do not silently change a shared filter. A selection with no compatible mapping remains local and has a visible indication near its component, distinct from the applied-filter summary. A selection with some compatible and some unmapped fields applies only the compatible fields in the same revision; the unmatched fields remain local and are visibly identified. A point click does not invent an interval for a date/numeric range; a date brush retains its existing range behavior. Grid column opt-in remains unchanged.

A click acts on the **underlying typed result**, not an ECharts or Perspective formatted label. The renderer adapters normalize their published selection events; they do not read raw files, inject SQL, or apply filters independently. Existing summary buttons remain keyboard-accessible alternatives for supported selections. If no chart family has a meaningful selectable dimension (for example a scalar gauge), it does not pretend that clicking is a filter action.

### Pending filter edits

The committed filter revision and the recipient's pending filter edits are separate. **Apply filters** commits the pending controls together; a chart, Perspective, grid, or summary selection commits all pending control edits **plus** the selection in one requested revision. If the selection targets a filter already edited in the controls, apply its replace/toggle semantics to the pending value. Successful publication synchronizes the controls to the accepted revision; a failed query visibly retains the prior results and restores controls to the prior committed revision. Superseded revisions cannot overwrite newer values or results.

Option search, option pagination, status updates, and unrelated component renders must preserve pending edits, selected values that are not on the current option page, typed search text, and keyboard focus. A refreshed option list changes options for its own filter only; it does not implicitly apply, clear, or roll back other filter controls.

## 2. Failure and control behavior

A non-credential option-search failure, including a live-source network/CORS interruption after the dashboard loaded, emits a visible retained error using the existing source-specific remedy where available. Previously valid results and options remain usable, the search can be retried, and the rejection is not silently swallowed by a debounced handler or page button. Credential retry still follows the remote-source contract; this change does not introduce credential persistence.

Boolean filters render as a native three-choice **All / Yes / No** control corresponding to `null / true / false`, including when the default is non-null. It can be operated by keyboard and returns to All without a reload. The YAML/default, runtime values, and bound SQL parameter semantics do not change.

## 3. Content component behavior

`text` and `heading` continue to render literal escaped content. `markdown` renders a documented safe subset: paragraphs, emphasis, unordered/ordered lists, and links. Source text is never inserted as trusted HTML. Raw HTML, images, scripts, embedded content, executable attributes, and unsupported Markdown constructs are rendered literally as text rather than executed or fetched. Links are created only for `https:`, `http:`, or `mailto:` destinations, with external navigation isolated from the dashboard; other destinations remain text. The viewer needs no broad CommonMark engine or new dependency to satisfy this subset. The authoring reference and examples distinguish literal text from supported Markdown.

## 4. Complexity and measured scale

Bounded Arrow result collection accounts for incoming batches incrementally and assembles the final Arrow IPC once. It preserves the existing 10,000-row, 8-MiB IPC, and 30-second limits, cancellation confirmation, duplicate-column rejection, and visible error behavior. An oversized incoming batch stops collection instead of allowing repeated whole-result serialization to grow with the number of batches. Correctness at the exact IPC-byte boundary must not be replaced with an inaccurate estimate.

Secret-looking URI/query-parameter detection used by compiler, runtime validator, and packager has one shared definition in the existing contract layer. This removes divergent copies without merging the distinct authoring, config, and packaging validation boundaries or weakening their existing rejections.

A reproducible probe builds representative large local CSV, JSON, and external-data ZIP cases and records input sizes, peak process/browser memory, and success or failure in the supported environment. The probe has **no invented performance SLA**. If the representative workflow fails to complete because of buffering or memory pressure, stop and shape the smallest evidence-backed streaming change; the owner did not approve a speculative streaming rewrite. Parquet's existing file-handle path remains unchanged.

The repository agent instructions must point to the existing `project/plans/`, `project/specs/`, and `project/agents/` authorities rather than nonexistent `docs/` paths. No planning artifacts are moved or duplicated.

## 5. Observable acceptance

1. **RI-01 — Chart selection:** clicking a mapped plotted mark (including a series/category case) changes the shared filter and query results; its typed value is not reconstructed from a display label. The summary-button/keyboard alternative still works.
2. **RI-02 — Perspective selection:** clicking a grouped-and-split Perspective mark with two compatible mappings applies both dimensions in one revision. An unmatched field stays local with visible feedback; an ambiguous field never guesses a shared filter.
3. **RI-03 — Draft coherence:** edit a filter without applying it, search/page another filter's options, then click a mark. Both the draft edit and selection become one coherent revision. A failed query restores prior controls/results, and an obsolete request never publishes.
4. **RI-04 — Recoverable search:** after a working live dashboard, an option read loses network access. The last valid results/options remain visible, an actionable error appears, and the recipient can retry.
5. **RI-05 — Boolean control:** a recipient moves from All to Yes to No and back to All with a keyboard, with corresponding typed filter values.
6. **RI-06 — Safe content:** paragraphs/emphasis/lists and an allowed link render; raw HTML and a `javascript:` link neither execute nor create an active link. Plain `text` remains literal.
7. **RI-07 — Arrow and scale:** multiple batches preserve the exact Arrow IPC size limit and cancellation behavior without serializing the accumulated result each time. A documented representative large-file probe reports evidence; streaming work is conditional on a reproduced failure.
8. **RI-08 — Hygiene:** all three secret-parameter validation paths still reject the existing secret-bearing examples; `AGENTS.md` resolves to the real artifact directories.

Use focused unit or browser checks for these named scenarios, not a theme/chart/filter matrix. Run `npm run check` for code changes and the supported desktop-Chrome browser gate for runtime/UI changes. A missing required Chrome installation is a gate blocker, not a passing or skipped acceptance claim.

## 6. Non-goals and handoff

No new data lifecycle, arbitrary chart options or scripts, general Markdown/HTML renderer, persisted filter drafts, remote writes, automatic publication, blanket accessibility audit, offline/Edge support, or unmeasured streaming implementation. The existing ZIP safety, deterministic build, bounded-query, credential, and source-replacement guarantees remain in force. The approved design and written specification authorize implementation planning, not implementation; integration and publication require their separate gates.

**Planning capture checkpoint (contract v1):** `Pending filter edits` is captured in the single-context glossary; `Filter revision` is unchanged. ADR 0006 already owns the architectural boundary; no new hard-to-reverse, surprising decision warrants an ADR. Behavior, non-goals, and acceptance are above. The large-file probe deliberately gates any streaming design; implementation of that branch is unresolved until evidence exists. Installed planning-skill provenance: unknown.

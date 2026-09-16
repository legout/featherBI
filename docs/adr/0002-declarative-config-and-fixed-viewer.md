---
status: superseded
superseded-by: 0006-compile-dashboard-projects-into-typed-viewers.md
---

# Share a declarative contract and fixed viewer

> Superseded for the target runtime by [ADR 0006](0006-compile-dashboard-projects-into-typed-viewers.md). The implemented v1 runtime still follows this decision until the v2 migration is complete.

Agents author versioned config, while deterministic tooling validates and packages a fixed viewer; agents do not hand-generate executable dashboard HTML. The authoring tool and browser share validation rules, and the renderer maps declarative bindings into Siemens iX/ECharts presentation rather than accepting arbitrary script, HTML, or chart callbacks.

This trades arbitrary dashboard-code flexibility for a common, testable authoring and rendering boundary. Recipients can filter and replace compatible data but do not edit SQL/layout or re-export from the viewer in v1. The accepted decision is recorded in the [runtime contract §§2–3, 7–8](../specs/runtime-contract-v1.md); its validation and acceptance criteria remain authoritative for implemented v1 behavior. Config validation does not make an untrusted HTML artifact safe.

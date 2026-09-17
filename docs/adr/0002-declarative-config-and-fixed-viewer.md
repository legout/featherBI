---
status: superseded
superseded-by: 0006-compile-dashboard-projects-into-typed-viewers.md
---

# Share a declarative contract and fixed viewer

> Superseded for the target runtime by [ADR 0006](0006-compile-dashboard-projects-into-typed-viewers.md). The v1 runtime followed this decision until the v2 migration removed it; the compiled project workflow is the implemented behavior now.

Agents author versioned config, while deterministic tooling validates and packages a fixed viewer; agents do not hand-generate executable dashboard HTML. The authoring tool and browser share validation rules, and the renderer maps declarative bindings into Siemens iX/ECharts presentation rather than accepting arbitrary script, HTML, or chart callbacks.

This trades arbitrary dashboard-code flexibility for a common, testable authoring and rendering boundary. Recipients can filter and replace compatible data but do not edit SQL/layout or re-export from the viewer. The accepted decision was recorded in [runtime contract §§2–3, 7–8](../specs/runtime-contract-v1.md) (now a superseded historical specification); [ADR 0006](0006-compile-dashboard-projects-into-typed-viewers.md) and the [dashboard project and runtime v2 specification](../specs/dashboard-project-and-runtime-v2.md) own the implemented behavior. Config validation does not make an untrusted HTML artifact safe.

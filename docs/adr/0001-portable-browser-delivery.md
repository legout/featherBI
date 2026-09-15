---
status: superseded
superseded-by: 0005-external-data-only-delivery.md
---

# Deliver portable dashboards without a local server

> Superseded by [ADR 0005](0005-external-data-only-delivery.md), which retains the no-server ZIP flow but removes embedded data.

The approved first-release sharing model uses embedded HTML or an extracted HTML-plus-data ZIP, opened through `file://` in desktop Chrome, rather than requiring recipients to run a server or install an authoring environment. Runtime dependencies may load online at pinned versions: portability does not promise offline operation, and separate ZIP data files require explicit selection rather than automatic sibling-file access.

This records the existing owner-approved scope in the [runtime contract §§1, 8](../specs/runtime-contract-v1.md) and [AP scenario](../specs/ap-inspection-dashboard.md), supported only within the measured limits of the [Chrome probe](../research/browser-feasibility-report.md). Edge support is not claimed; source-system access controls do not accompany shared rows. No packaging action implicitly authorizes publication.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Mixed recipients of generated dashboards: business users who need to understand the current situation quickly, and analysts who filter, compare and explore. Dashboard authors use an agent skill to create the dashboards from local or remote data.

## Product Purpose

featherBI turns a dashboard description into deterministic standalone BI dashboards. Recipients should first grasp the state of the data quickly, then narrow it with filters and cross-filters, and explore further only when needed.

## Positioning

featherBI produces an interactive dashboard as one self-contained HTML artifact, opened by double-click or offline, without a server or dashboard service.

## Operating Context

Recipients open generated files from local storage or shared links in a desktop browser; dashboards must also remain usable on smaller screens. Snapshot data is embedded or fetched from configured remote storage.

## Capabilities and Constraints

- Single-file HTML output is a hard product constraint; standalone and offline modes must remain usable.
- Tiles cover KPIs, ECharts presets, pivot tables, source and SQL tables, text, sections and tabs.
- Filters are shared across tiles and are reflected in the URL hash. Multi-select per dimension is not yet specified and needs a separate behavior specification.
- Page chrome is provided through the versioned shell v1 contract.

## Evidence on Hand

Repository fixtures and examples under `fixtures/` and `examples/` provide synthetic demonstration data. No customer testimonials, benchmarks or production deployments are documented.

## Product Principles

- Make the current situation understandable before inviting exploration.
- Keep every dashboard portable as one file.
- Preserve trustworthy filter state and copied links.
- Use exploration depth only when a recipient needs it.

# ADR 0004: Built-in dashboard designs

Status: **accepted** (owner, 2026-11-28, together with spec 0006 r1). Amends [ADR 0003](0003-replaceable-page-shell.md).

## Context

ADR 0003 made the page chrome replaceable through an installation-level `--shell <file>` and rejected a shell key in `dashboard.yaml`. The owner now wants generated dashboards to support several built-in visual and layout designs, with the agent asking for the design while creating a dashboard.

## Decision

1. `dashboard.yaml` gets an optional `design` key with built-in values (`classic-bi`, `market-desk`, `timetable-board`, `visible-grid`).
2. Built-in designs are skill assets. A config therefore depends only on names that every installation of the skill ships.
3. `classic-bi` is the default for configs without `design`.
4. `--shell <file>` remains the installation override and wins over `design`; the requested design name is passed to the shell as read-only data.
5. Themes remain the colour, font, logo and radius layer. Designs own layout and presentation.

## Alternatives considered

- **CLI-only selection:** rejected because the selected design would not travel with the dashboard config.
- **Four external shell files selected with `--shell`:** rejected because authors would depend on installation paths, not stable design names.
- **One fixed default design:** rejected because the owner wants the agent to offer different dashboard designs.

## Consequences

- ADR 0003's rejection of a config-level selector is narrowed: config may select built-in designs, but not arbitrary shell files.
- The shell contract gains a read-only design name and tile size, so alternate shells can honour or ignore them.
- Visual regression checks must cover four designs, not only one default page.

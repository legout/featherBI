# Verification and packaging evidence

Config validation alone is never success. Verify against visible runtime evidence at each gate and report what you observed.

## Preview verification

1. Extract the built ZIP to a scratch location and open `dashboard.html` through `file://` in desktop Chrome (never a dev server).
2. Select each declared data file under **Data files**; the status must reach "Dashboard ready".
3. Compare visible values with independent evidence: KPI counts against the profile row count or a direct query; grouped charts against per-group counts; percentages against hand-computed ratios.
4. Exercise at least one filter and confirm every view updates together and stale results never appear.
5. After a feedback edit, name the exact visible difference the user should now see (label, position, axis, color) and confirm it in the reopened preview.

## Packaging verification

Before handing over a ZIP:

- **Members:** exactly `dashboard.html` plus one member per declared source; relative basenames only.
- **Secrecy:** the HTML contains neither dataset bytes nor absolute local paths (`grep` the extracted HTML for the source path and a distinctive payload value).
- **Reopen:** a fresh extraction opened in Chrome shows the expected values after explicit file selection.
- **Determinism:** rebuilding without changes produces a byte-identical artifact (same sha256).

## Source hygiene

After the ordinary workflow, `git status` may show only approved YAML/SQL/CSS source changes. `.featherbi/`, ZIPs, screenshots, profiles, and data files stay ignored; restore or delete anything else before finishing.

## Final report to the user

List: project source paths edited; commands run; evidence observed (profile facts, Chrome values, ZIP member/secrecy/reopen checks); decisions still open (unconfirmed joins, deferred views); and the reminder that commit, push, publication, and release are separate owner actions.

---
name: featherbi
description: Profile local CSV, Parquet, or JSON sample data and author, iterate, or package a featherBI dashboard project - compile to runtime contract 2, preview in desktop Chrome, and deliver an external-data ZIP. Use for dataset-to-dashboard requests; not for generic SQL analysis, spreadsheet cleanup, or editing unrelated web pages.
---

# featherBI authoring

Turn local sample data into an editable dashboard project, verify it in desktop Chrome, and package it as an external-data ZIP. Generated state (profiles, compiled config, previews, ZIPs, screenshots) lives only in the project's ignored `.featherbi/` directory. Never hand-write executable dashboard HTML; edit YAML/SQL/CSS source and rebuild.

## Start safely

Work anywhere with `featherbi` on PATH, keep the project's own files, and use Git as the iteration history:

```sh
command -v featherbi || npm link   # once, from a featherBI checkout
```

Without a global link, run from a checkout: `npm ci`, then `node bin/featherbi.mjs <command> ...`.

## Workflow

1. **Locate sources.** Ask for one or more representative local CSV/Parquet/JSON files. Reference them by absolute path in commands only; never copy the bytes into the project or context.

2. **Profile without copying.** Create the project workspace (an ignored `.featherbi/` directory) and profile each source:

   ```sh
   featherbi profile --input /absolute/local/file.parquet \
     --source-id inspections --format parquet \
     --output path/to/project/.featherbi/profile.json
   ```

   Remote sources are profiled the same way with a read-only `s3://` or `https://` URI and `--auth none|s3`. For `auth: s3`, credentials follow the authoring credential rule in [references/project-reference.md](references/project-reference.md). Report material row/schema/null/cardinality evidence and stop on profile errors — never guess a schema. `--include-values` requires explicit permission and stays bounded. Details: [references/failures.md](references/failures.md).

3. **Interview progressively.** Show the evidence, then ask only material questions in order: audience/decisions; metric meanings and grain; default population and filters; ambiguous relationships (joins need explicit confirmation with keys and expected cardinality); then appearance (preset, theme, or a style described in words and authored as `theme.tokens.yaml`, layout). Recommend defaults from evidence; never invent business definitions. Decision tree: [references/interview.md](references/interview.md).

4. **Scaffold the project.** Copy [`templates/basic-dashboard/`](templates/basic-dashboard/) and shape it into the smallest dashboard that answers the stated decisions. Source files are `dashboard.yaml`, `queries/*.sql`, optional `models/*.sql`, `theme.tokens.yaml`, and `theme.css`. Schema and examples: [references/project-reference.md](references/project-reference.md); component/filter catalog: [references/components.md](references/components.md); metrics and SQL admission: [references/metrics-and-sql.md](references/metrics-and-sql.md); themes: [references/themes-and-css.md](references/themes-and-css.md).

5. **Compile and preview.** Compile to strict runtime contract 2, fix every reported filename/line/column error, then build with the target the sources allow — propose `static` when every declared source is live and `zip` otherwise — and preview in desktop Chrome:

   ```sh
   featherbi compile --project path/to/project/dashboard.yaml
   featherbi build \
     --target static \
     --config path/to/project/.featherbi/dashboard.config.json \
     --output path/to/project/.featherbi/dashboard.html
   # any local or packaged source → zip, with one --source per file:
   featherbi build \
     --target zip \
     --config path/to/project/.featherbi/dashboard.config.json \
     --source inspections=/absolute/local/file.parquet \
     --output path/to/project/.featherbi/dashboard.zip
   ```

   The static target accepts only live sources; a local file or packaged source fails the build naming the source and the remedy. Open the static `dashboard.html` in desktop Chrome: its live sources load without file selection (network access required). For the zip target, extract the ZIP, open `dashboard.html`, and select the local files under **Data files**. Verify visible values against independent profile/query evidence. What to check: [references/verification.md](references/verification.md).

6. **Iterate from feedback.** Treat every revision request as an edit to the same YAML/SQL/CSS source. Rebuild, reselect data when required, and point out the visibly changed output before asking for more feedback. Let Git record history; do not create parallel ledgers. Stop when the draft is approved or the user pauses.

7. **Package for sharing.** Re-run compile/build for the chosen target, then verify the artifact before handing it over. Static: the output is exactly one `dashboard.html` containing no dataset bytes, credentials, or absolute local paths, and a fresh copy opens in Chrome reading its live sources without file selection. Zip: the bundle contains `dashboard.html` plus one member per packaged source (local files and packaged remote sources; live remote sources instead read their URI in the recipient's browser and have no member), and a fresh extraction reopens in Chrome after explicit file selection. Packaging never publishes, uploads, or commits anything.

8. **Report.** Summarize source paths edited, commands run, evidence observed (profile facts, Chrome values, ZIP checks), and remaining decisions. Commit, push, publication, and release are separate owner actions.

Evaluation fixtures for this skill (trigger and execution cases) live in [evals/evals.json](evals/evals.json).

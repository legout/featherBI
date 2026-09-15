---
name: featherbi
description: Author and package declarative featherBI dashboards from local data. Use when asked to create, validate, or share a featherBI dashboard; unlike web-app generators, this skill never writes executable HTML by hand.
---

# featherBI authoring

## State check

Work from the featherBI repository root:

```sh
test -f bin/featherbi.mjs
npm ci
```

Stop if either command fails. Do not substitute a hand-written HTML page.

## Workflow

1. Write an upload-mode contract-v1 JSON config. Start from [`examples/ap.config.json`](examples/ap.config.json) when useful; keep source IDs, schemas, filters, SQL, and component bindings declarative.
2. Validate and fix every reported issue before packaging:

   ```sh
   node bin/featherbi.mjs validate --config path/to/dashboard.config.json
   ```

3. Build with one explicit `--source ID=LOCAL_FILE` for every declared source:

   ```sh
   node bin/featherbi.mjs build --config path/to/dashboard.config.json \
     --source ap=path/to/ap.json --mode embedded --output dashboard.html

   node bin/featherbi.mjs build --config path/to/dashboard.config.json \
     --source ap=path/to/ap.json --mode zip --output dashboard.zip
   ```

4. Open the HTML through `file://` in desktop Chrome. For ZIP delivery, extract it first, open `dashboard.html`, and explicitly select each extracted data file.
5. If validation, build, or opening fails, preserve the error, correct the config or source assignment, and repeat validation before rebuilding.

## Safety and output

- Existing outputs are never replaced unless the author adds `--overwrite` explicitly.
- Packaging creates local files only; it does not upload, publish, deploy, commit, or grant recipient access.
- Embedded artifacts contain all mapped rows. ZIP recipients receive all extracted data members. Share only with authorized recipients.
- Runtime dependencies load online at pinned versions. Offline and Edge support are not claimed.
- A successful run prints the output path, mode, byte count, and SHA-256 digest. Report those values and the Chrome reopening result; do not claim success from config validation alone.

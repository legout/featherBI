# Troubleshooting

Build errors start with `featherbi:` and exit 1; nothing is written (a `--split` folder is only touched after every check passes). Fix the config and rebuild.

| Message (start) | Cause and fix |
|---|---|
| `the DuckDB CLI (>= 2.0) was not found on PATH` | Install DuckDB >= 2.0. |
| `<file>: \`title\` is required` / `\`sources\` needs at least one source` / `\`tiles\` needs at least one tile` | Add the key. |
| `\`engine\` must be one of: haybarn, duckdb-wasm` | Fix or remove `engine`. |
| `source "<name>": the name must be a plain identifier` | Rename the source: letters, digits, `_`, not starting with a digit. |
| `source "<name>": \`<key>\` looks like a credential` | Remove it. Use the environment, `~/.pgpass` or a DuckDB secret (`sources.md`). |
| `source "<name>": give either \`read\` … or \`attach\`` | A source has exactly one of the two; `attach` also needs `table` or `sql`. |
| `source "<name>": …` followed by DuckDB's error above it | The source could not be read: wrong path (relative to the config file), missing extension or file. Run `profile` on it to test. |
| `invalid config: config.…: …` | Schema error; the path says which key. |
| `dims: \`date\` is reserved…` | Rename the dimension. |
| `tile "<id>": unknown type` / `unknown preset` | Types: `kpi`, `echarts`, `pivot`, `table`, `text`. Presets: `presets.md`. |
| `tile "<id>": missing result column "<c>" (got …)` | The SQL must return the columns the tile or preset requires; alias them (`region AS x`). |
| `tile "<id>": SQL failed…` | Fix the SQL. "with sample filter values" means a filter placeholder broke it: an ambiguous column in a join (use `{{filters:<table> AS <alias>}}`) or a missing alias. Only snapshot tables and core functions exist: no extensions, no files. |
| `tile "<id>": click on "<dim>", which is not declared in \`dims\`` | Declare the dimension. |
| `tile "<id>": option key "<k>" binds data` | Remove it; `option` styles only. |
| `tile "<id>": column "<c>" is not in source "<s>"` | Fix the `table` tile's `columns` or `source`. |
| `\`{{filters:<t>}}\` names a table that is not a source` / `unknown placeholder` | Use a source name; syntax is `{{filters:<table>}}` or `{{filters:<table> AS <alias>}}`. |
| `--offline and --split cannot be combined` | Pick one. |
| `--offline is not available for engine "duckdb-wasm"` | Remove `--offline` or use `engine: haybarn`. |
| `--split: <dir> holds files a featherBI build did not write` | Build into another folder (`--out`) or clear it yourself. |
| `--split: <path> is a file` | `--out` must name a folder with `--split`. |

## Warnings and runtime

- **`the embedded Parquet is N MB, above 25 MB`**: the page is slow to open and share. Use `--split`, or aggregate in the source SQL.
- **A `--split` page is blank from `file://`**: serve the folder (`python3 -m http.server`).
- **The default page is blank offline**: it loads JS from a CDN. Build with `--offline` (Haybarn engine).
- **A tile shows `–`**: its `sql` returned no row or NULL.
- **A chart is empty after a click**: the tile filters itself. Add `exclude: [<dim>]`.
- **Different bytes between builds**: source SQL uses a clock or `random()`, the data changed, or the DuckDB version differs.

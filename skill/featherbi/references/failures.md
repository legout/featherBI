# Failure procedures

Every failure is reported with its exact source location and the operation that failed. Fix the reported defect, rerun the same command, and stop rather than improvising when the cause is not in the project source.

## Profiling

Report the logical source ID, format, and failed operation ("profile of inspections (parquet) failed reading timestamps"). Never fabricate a schema or continue with guessed metrics. An unsupported format/type is a user decision, not something to work around by copying data.

## Compilation

Compile errors name `file:line:column` in the project source. Common causes:

- unknown/misspelled YAML keys or versions → fix the reported key;
- query SQL outside `queries/<id>.sql`, unreadable, or multi-statement → fix the path or SQL;
- undeclared source/model in SQL → declare it or correct the name;
- `joins require a confirmed relationship` → return to the interview; never add `confirmed: true` without the user's explicit agreement on keys and cardinality;
- layout overlap or out-of-grid placement → adjust integer coordinates;
- parameter mismatch → align `params` with the `$placeholders` in order.

## Build and packaging

A failed build preserves the prior artifact. Check the config path, explicit `--source ID=file` assignments, and output path. Refuse to overwrite outputs without `--overwrite`, and never let an output overwrite its config or a source file.

## Preview (Chrome)

Require: extracted ZIP (not the in-place folder), `file://` in desktop Chrome, online pinned runtime assets, and explicit selection of every declared data file. A visible boot error (for example missing pinned assets) is reported to the user, never worked around by hand-editing HTML.

## Verification mismatch

If visible values disagree with profile/query evidence, stop and reconcile before sharing: rerun the profile or an independent query, fix the source, rebuild, reverify. A config that validates is not a verified dashboard.

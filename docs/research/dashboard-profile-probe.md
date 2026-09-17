# Bounded dashboard profile probe

## Question and threshold

Can a portable skill-side script profile CSV, JSON arrays, NDJSON, and Parquet without placing the complete input in agent context, including the approved 390,548,300-byte private Parquet case required by [runtime v2 §16](../specs/dashboard-project-and-runtime-v2.md#16-required-feasibility-work)?

Acceptance required a bounded machine-readable profile containing schema, row/null/distinct/range/top-value evidence; no raw rows, private values, or absolute source path; and observed time/memory on the real large file.

## Environment and exact versions

- macOS 26.6.2 (25G83), arm64
- Python 3.14.0
- `uv 0.12.15`
- `duckdb 1.4.3` in an isolated `uv run --with` environment
- `/usr/bin/time` from macOS

DuckDB's official documentation describes the [`read_csv`](https://duckdb.org/docs/stable/data/csv/overview.html), [`read_json_auto`](https://duckdb.org/docs/stable/data/json/overview.html), and [`read_parquet`](https://duckdb.org/docs/stable/data/parquet/overview.html) table functions used here. The implementation should keep the memory and thread controls documented in [DuckDB resource management](https://duckdb.org/docs/stable/guides/performance/how_to_tune_workloads.html).

## Reproducible command and prototype shape

All source, outputs, and the isolated package environment lived under an OS temporary directory. `PRIVATE_AP` was set to the owner-approved local source path; the path is intentionally omitted from durable output.

```sh
uv run --with duckdb==1.4.3 python profile.py rows.csv \
  --format csv --source-id small-csv > small-csv.json
uv run --with duckdb==1.4.3 python profile.py rows.json \
  --format json --source-id small-json > small-json.json
uv run --with duckdb==1.4.3 python profile.py rows.ndjson \
  --format ndjson --source-id small-ndjson > small-ndjson.json
uv run --with duckdb==1.4.3 python profile.py rows.parquet \
  --format parquet --source-id small-parquet > small-parquet.json
/usr/bin/time -l -o private.time uv run --with duckdb==1.4.3 \
  python profile.py "$PRIVATE_AP" --format parquet \
  --source-id private-ap --redact-values > private.json
```

The small prototype opened an in-process DuckDB connection, set `memory_limit='512MB'`, `threads=4`, and `preserve_insertion_order=false`, and passed the file path as a query parameter to one of the four reader expressions. It emitted only:

- caller-supplied source ID, format, and byte size;
- column names and logical types;
- row and null counts;
- `approx_count_distinct` values, explicitly approximate;
- minima/maxima for non-private fixtures;
- at most five top-value/count pairs only when approximate distinct count was at most 1,000; and
- elapsed seconds and the applied limits.

`--redact-values` replaced every top value with `null`, omitted ranges, and retained aggregate counts. The result used `source_id`, never the input path.

## Observed evidence

The small inputs were five inspection records derived from the repository's representative fixture. CSV, JSON-array, NDJSON, and Parquet all returned eight-column profiles and the expected five rows. Their output sizes were respectively 1,951, 1,973, 1,977, and 1,979 bytes. Their wall times were 0.11, 0.08, 0.09, and 0.08 seconds; observed maximum resident set sizes were 59,162,624, 53,755,904, 54,607,872, and 54,312,960 bytes. These are single-run macOS `/usr/bin/time -l` observations, not benchmark claims.

The private Parquet input produced:

| Observation | Value |
|---|---:|
| input bytes | 390,548,300 |
| rows | 5,384,125 |
| columns | 70 |
| profile bytes | 12,455 |
| script-reported elapsed | 1.600 s |
| `/usr/bin/time` wall time | 1.67 s |
| observed maximum RSS | 107,069,440 bytes |
| raw rows emitted | 0 |
| values emitted | 0 |

The private output included schema types, null counts, approximate distinct counts, and top-count arrays for low-cardinality columns. It contained no minima, maxima, or top values. The complete input was scanned by DuckDB in place; the Python process never read it into a Python list or copied it into the profile. Temporary DuckDB spill was permitted by the memory limit, though this run reported zero block-output operations.

## Limitations and rejected approaches

- Automatic CSV inference made a digit-only identifier numeric while JSON and Parquet retained it as text. Production profiling must apply a declared schema when available and label inference when it is not.
- The disposable script issued separate aggregate queries per column. This kept implementation and output bounded but can rescan CSV/JSON many times. Issue #5 should generate one batched null/distinct/range aggregate and reserve separate top-k queries for plausible categorical columns.
- Approximate distinct counts can differ from exact cardinality and must remain labelled approximate.
- The tested JSON forms were an array of objects and newline-delimited objects. Nested objects, arrays, unions, malformed records, encoding variants, and compressed inputs remain format-specific error cases rather than guessed schemas.
- A 256 MB first attempt failed during unbounded high-cardinality top-k grouping. The accepted prototype added the 1,000-distinct gate and 512 MB cap rather than hiding the failure or increasing memory without a bound.
- Reading the file in Python, serializing sample rows, and putting profiles on stdout with absolute paths were rejected because they violate the context and privacy boundary.

## Verdict: PASS

DuckDB 1.4.3 is a viable portable profiling seam for all four formats, and the real large Parquet profile was small and bounded without exposing rows or values. This is feasibility evidence, not production-ready profiling code.

## Consequence for issue #5 and specification

Issue #5 can implement one ignored local profile artifact around a pinned DuckDB script. It should batch aggregate expressions, accept declared schemas, gate top-k by type/cardinality, make raw samples opt-in, and serialize only logical source IDs. No change to the [approved specification](../specs/dashboard-project-and-runtime-v2.md) is indicated.

## Cleanup

The script, synthetic CSV/NDJSON/Parquet, private profile, timing files, `uv` environment state, and logs were deleted from the temporary probe directory after evidence was recorded. No data file, source path, profile, package, or generated output is tracked.

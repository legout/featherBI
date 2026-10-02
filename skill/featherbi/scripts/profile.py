#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==1.5.5"]
# ///
"""Emit a bounded DuckDB profile without paths, URIs, or raw values by default."""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import duckdb  # pyright: ignore[reportMissingImports] # resolved by `uv run --script` from the PEP 723 block above

MAX_COLUMNS = 100
MAX_TEXT_LENGTH = 256
TOP_LIMIT = 5
SOURCE_ID = re.compile(r"^[a-z][a-z0-9_]*$")
LOW_CARDINALITY_LIMIT = 1000
MEMORY_LIMIT = "512MB"
THREADS = 4
REMOTE_INPUT = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)
ENV_PREFIX = "FTHR_S3_"
# Upper bound on one profiled Parquet file set (spec 2026-09-28-0004 §2.1).
PARQUET_SET_MAX_FILES = 10_000
# Upper bound on one Parquet-set manifest document (spec §2.1).
PARQUET_SET_MANIFEST_MAX_BYTES = 2 * 1024 * 1024
# Shape one Parquet-set manifest URI must have (spec §2.1).
PARQUET_SET_MANIFEST_URI = re.compile(r"^s3://[A-Za-z0-9._~/-]+\.json$")


def identifier(name):
    return '"' + name.replace('"', '""') + '"'


def is_remote(input_path):
    return bool(REMOTE_INPUT.match(input_path))


def read_relation(con, input_path, format_name):
    if format_name == "csv":
        return con.read_csv(input_path)
    if format_name == "json":
        return con.read_json(input_path, format="array")
    if format_name == "ndjson":
        return con.read_json(input_path, format="newline_delimited")
    return con.read_parquet(input_path)


def env_with_dotenv():
    """Process environment overlaid with a manually parsed .env from cwd upward."""
    values = dict(os.environ)
    for directory in [Path.cwd(), *Path.cwd().parents]:
        candidate = directory / ".env"
        if candidate.is_file():
            for line in candidate.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                line = line.removeprefix("export ")
                key, sep, value = line.partition("=")
                if not sep or not key.strip():
                    continue
                value = value.strip().strip('"').strip("'")
                values.setdefault(key.strip(), value)
            break
    return values


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def s3_credentials(source_id, values, auth="s3", region=None, endpoint=None):
    """Resolve S3 credentials for one source; raise with the required secret named."""
    def get(name):
        return values.get(f"{ENV_PREFIX}{name}", "")

    key_id = get("KEY_ID")
    secret = get("SECRET")
    if auth == "s3" and (not key_id or not secret):
        raise ValueError(
            f"source {source_id!r} requires S3 credentials; set {ENV_PREFIX}KEY_ID "
            f"and {ENV_PREFIX}SECRET in the process environment or in a gitignored "
            ".env file (see .env.example), or configure the AWS credential chain"
        )
    region = region or get("REGION")
    endpoint = endpoint or get("ENDPOINT")
    options = []
    # Anonymous sets (auth none) on an S3-compatible endpoint still need the
    # endpoint secret; they simply carry no key material.
    if auth == "s3" and key_id and secret:
        options.append(f"KEY_ID {sql_literal(key_id)}")
        options.append(f"SECRET {sql_literal(secret)}")
        session_token = get("SESSION_TOKEN")
        if session_token:
            options.append(f"SESSION_TOKEN {sql_literal(session_token)}")
    for value, sql_name in (
        (region, "REGION"),
        (endpoint, "ENDPOINT"),
    ):
        if value:
            options.append(f"{sql_name} {sql_literal(value)}")
    use_ssl = get("USE_SSL").lower()
    if use_ssl in ("true", "false"):
        options.append(f"USE_SSL {use_ssl}")
    if endpoint:
        # ponytail: path-style for explicit endpoints; add a URL_STYLE override if a virtual-hosted S3-compatible endpoint appears.
        options.append("URL_STYLE 'path'")
    # DuckDB secret options are comma-separated; a space join is a parse error.
    return ", ".join(options)


def load_httpfs(con):
    """Load httpfs, installing it once into the DuckDB extension cache if missing."""
    try:
        con.execute("LOAD httpfs")
    except duckdb.Error:
        con.execute("INSTALL httpfs")
        con.execute("LOAD httpfs")


def credential_chain_secret(con):
    """Create a temporary secret from the AWS credential chain; report success."""
    try:
        con.execute(
            "CREATE OR REPLACE TEMPORARY SECRET fthr_s3 "
            "(TYPE s3, PROVIDER credential_chain)"
        )
        return True
    except duckdb.Error:
        # A failed creation leaves nothing behind; CREATE OR REPLACE in the
        # config-provider path below supersedes any earlier secret.
        return False


def configure_remote(con, input_path, source_id, auth, secret_values, region=None, endpoint=None):
    load_httpfs(con)
    if auth == "s3" and credential_chain_secret(con):
        return
    if auth != "s3" and not endpoint:
        return
    con.execute(
        "CREATE OR REPLACE TEMPORARY SECRET fthr_s3 "
        f"(TYPE s3, PROVIDER config, {s3_credentials(source_id, secret_values, auth, region, endpoint)})"
    )


def resolve_parquet_set(con, input_path, selector_glob, source_id):
    """Resolve one Parquet set's glob into a bounded, sorted file list.

    The resolved keys stay in memory only; they never reach the portable
    report (spec 2026-09-28-0004 §5).
    """
    pattern = f"{input_path}{selector_glob}"
    files = [
        row[0]
        for row in con.execute(
            f"SELECT file FROM glob({sql_literal(pattern)}) "
            f"LIMIT {PARQUET_SET_MAX_FILES + 1}"
        ).fetchall()
    ]
    if not files:
        raise ValueError(
            f"source {source_id!r}: selector glob {selector_glob!r} under the "
            "declared prefix resolved no Parquet files; check the prefix, the "
            "pattern, and the bucket's list permission"
        )
    if len(files) > PARQUET_SET_MAX_FILES:
        raise ValueError(
            f"source {source_id!r}: selector glob matched more than "
            f"{PARQUET_SET_MAX_FILES} Parquet files; narrow the glob"
        )
    return sorted(files)


def manifest_entry_reason(entry):
    """One rejection reason for an invalid manifest entry, or None."""
    if not isinstance(entry, str):
        return "is not a string"
    if entry == "":
        return "is empty"
    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in entry):
        return "contains control characters"
    if entry.startswith("/"):
        return "is absolute; entries are relative to the declared prefix"
    if "://" in entry:
        return "is a URL, not a relative object key"
    if "\\" in entry:
        return 'uses a backslash separator; use "/"'
    if ".." in entry.split("/"):
        return 'escapes the declared prefix with ".."'
    if "?" in entry or "#" in entry:
        return "carries a query or fragment; entries are plain object keys"
    if not entry.endswith(".parquet"):
        return "is not a Parquet object"
    return None


def resolve_manifest_set(con, input_path, manifest, source_id):
    """Resolve one Parquet set's manifest into a bounded, sorted file list.

    Fetches the manifest through the same native DuckDB secret machinery as
    the object reads, enforces the 2 MiB and 10,000 caps before parsing, and
    validates every entry as a relative Parquet key below the declared
    prefix. The resolved keys stay in memory only (spec §5).
    """
    if not PARQUET_SET_MANIFEST_URI.fullmatch(manifest or ""):
        raise ValueError(
            f"source {source_id!r}: manifest must be an s3:// URI of a .json "
            "object, such as 's3://reports/sales/manifest.json'"
        )
    text = con.execute(
        f"SELECT content FROM read_text({sql_literal(manifest)})"
    ).fetchone()[0]
    if not isinstance(text, str) or not text.strip():
        raise ValueError(
            f"source {source_id!r}: manifest {manifest!r} is empty or unreadable"
        )
    if len(text) > PARQUET_SET_MANIFEST_MAX_BYTES or len(text.encode("utf-8")) > PARQUET_SET_MANIFEST_MAX_BYTES:
        raise ValueError(
            f"source {source_id!r}: manifest {manifest!r} exceeds the 2 MiB "
            "limit; split the file set or narrow the manifest"
        )
    try:
        document = json.loads(text)
    except ValueError as error:
        raise ValueError(
            f"source {source_id!r}: manifest {manifest!r} is not valid JSON "
            f"({error})"
        ) from error
    entries = document.get("files") if isinstance(document, dict) else None
    if not isinstance(entries, list):
        raise ValueError(
            f"source {source_id!r}: manifest {manifest!r} must be a JSON object "
            'like {"files": ["year=2026/part-1.parquet"]}'
        )
    files = []
    for entry in entries:
        reason = manifest_entry_reason(entry)
        if reason is not None:
            raise ValueError(
                f"source {source_id!r}: manifest entry {entry!r} {reason}; "
                f"manifest entries are relative Parquet keys below {input_path!r}"
            )
        file = f"{input_path}{entry}"
        if not file.startswith(input_path):
            raise ValueError(
                f"source {source_id!r}: manifest entry {entry!r} resolves outside "
                f"the declared prefix {input_path!r}"
            )
        if file not in files:
            files.append(file)
    if not files:
        raise ValueError(
            f"source {source_id!r}: manifest {manifest!r} lists no Parquet "
            'files; check its "files" list'
        )
    if len(files) > PARQUET_SET_MAX_FILES:
        raise ValueError(
            f"source {source_id!r}: manifest {manifest!r} lists more than "
            f"{PARQUET_SET_MAX_FILES} Parquet files; narrow the manifest"
        )
    return sorted(files)


def value_json(value):
    if value is None or isinstance(value, (int, float, bool)):
        return value
    text = str(value)
    return text if len(text) <= MAX_TEXT_LENGTH else text[:MAX_TEXT_LENGTH] + "…"


def profile(input_path, source_id, format_name, auth="none", include_values=False, secret_values=None, region=None, endpoint=None, selector_glob=None, selector_manifest=None):
    remote = is_remote(input_path)
    if (selector_glob is not None or selector_manifest is not None) and not remote:
        raise ValueError("a selector requires a remote s3:// prefix input")
    if selector_glob is not None and selector_manifest is not None:
        raise ValueError("a parquet-set selector requires exactly one of glob or manifest")
    size = None if remote else os.path.getsize(input_path)
    con = duckdb.connect(":memory:")
    con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")
    con.execute(f"SET threads={THREADS}")
    con.execute("SET preserve_insertion_order=false")
    if remote:
        configure_remote(con, input_path, source_id, auth, secret_values or {}, region, endpoint)
    files = None
    selector = None
    if selector_glob is not None:
        files = resolve_parquet_set(con, input_path, selector_glob, source_id)
        relation = con.read_parquet(files)
        selector = {"glob": selector_glob}
    elif selector_manifest is not None:
        files = resolve_manifest_set(con, input_path, selector_manifest, source_id)
        relation = con.read_parquet(files)
        selector = {"manifest": selector_manifest}
    else:
        relation = read_relation(con, input_path, format_name)
    columns = list(zip(relation.columns, map(str, relation.types), strict=True))
    if len(columns) > MAX_COLUMNS:
        raise ValueError(f"source has {len(columns)} columns; maximum is {MAX_COLUMNS}")
    if any(len(name) > MAX_TEXT_LENGTH or len(type_name) > MAX_TEXT_LENGTH for name, type_name in columns):
        raise ValueError(f"column names and types must be at most {MAX_TEXT_LENGTH} characters")

    expressions = ["count(*) AS row_count"]
    range_indexes = {}
    for index, (name, type_name) in enumerate(columns):
        column = identifier(name)
        expressions.extend([
            f"count(*) - count({column}) AS null_{index}",
            f"approx_count_distinct({column}) AS distinct_{index}",
        ])
        upper = type_name.upper()
        if include_values and any(token in upper for token in ("INT", "DECIMAL", "DOUBLE", "FLOAT", "REAL", "DATE", "TIME")):
            range_indexes[index] = len(expressions)
            expressions.extend([f"min({column}) AS min_{index}", f"max({column}) AS max_{index}"])
    aggregate = relation.aggregate(", ".join(expressions)).fetchone()
    if aggregate is None:
        raise ValueError("aggregate query returned no result")

    result_columns = []
    cursor = 1
    for index, (name, type_name) in enumerate(columns):
        null_count = aggregate[cursor]
        approximate_distinct = aggregate[cursor + 1]
        cursor += 2
        item = {
            "name": name,
            "type": type_name,
            "null_count": null_count,
            "approximate_distinct_count": approximate_distinct,
            "distinct_count_kind": "approximate",
        }
        if index in range_indexes:
            item["range"] = {
                "min": value_json(aggregate[cursor]),
                "max": value_json(aggregate[cursor + 1]),
            }
            cursor += 2
        upper = type_name.upper()
        plausible_category = any(token in upper for token in ("VARCHAR", "CHAR", "BOOL", "DATE"))
        if include_values and plausible_category and approximate_distinct <= LOW_CARDINALITY_LIMIT:
            selected = relation.select(duckdb.ColumnExpression(name).alias("value"))
            rows = (
                selected.aggregate("value, count(*) AS count", "value")
                .order("count DESC, value")
                .limit(TOP_LIMIT)
                .fetchall()
            )
            item["top_counts"] = [
                {"value": value_json(value), "count": count} for value, count in rows
            ]
        result_columns.append(item)
    con.close()
    payload = {
        "profile": 1,
        "source_id": source_id,
        "format": format_name,
        "file_bytes": size,
        "row_count": aggregate[0],
        "columns": result_columns,
        "values_included": include_values,
        "limits": {
            "memory": MEMORY_LIMIT,
            "threads": THREADS,
            "max_columns": MAX_COLUMNS,
            "max_text_characters": MAX_TEXT_LENGTH,
            "top_values_per_column": TOP_LIMIT,
            "top_value_cardinality_gate": LOW_CARDINALITY_LIMIT,
        },
    }
    if files is not None:
        # Bounded Parquet-set metadata only: the file count and the declared
        # selector, never the enumerated object keys (spec 2026-09-28-0004 §5).
        payload["kind"] = "parquet-set"
        payload["file_count"] = len(files)
        payload["selector"] = selector
        payload["limits"]["max_parquet_set_files"] = PARQUET_SET_MAX_FILES
        payload["limits"]["max_parquet_set_manifest_bytes"] = PARQUET_SET_MANIFEST_MAX_BYTES
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--format", required=True, choices=("csv", "json", "ndjson", "parquet"))
    parser.add_argument("--auth", choices=("none", "s3"), default="none", help="s3 requires credentials via the AWS chain or FTHR_S3_* .env variables")
    parser.add_argument("--region")
    parser.add_argument("--endpoint")
    parser.add_argument("--include-values", action="store_true", help="include bounded ranges/top values after user permission")
    selector = parser.add_mutually_exclusive_group()
    selector.add_argument("--glob", help='relative Parquet-object pattern for one live Parquet set, e.g. "year=*/part-*.parquet" (requires --format parquet and an s3:// prefix input)')
    selector.add_argument("--manifest", help='s3:// URI of the .json manifest for one live Parquet set, e.g. "s3://reports/sales/manifest.json" (requires --format parquet and an s3:// prefix input)')
    parser.add_argument("--output")
    args = parser.parse_args()
    if not SOURCE_ID.fullmatch(args.source_id):
        parser.error("--source-id must match ^[a-z][a-z0-9_]*$")
    if args.glob:
        if args.format != "parquet":
            parser.error("--glob requires --format parquet")
        if (
            args.glob.startswith("/")
            or ".." in args.glob.split("/")
            or not args.glob.endswith(".parquet")
        ):
            parser.error(
                '--glob must be a relative Parquet-object pattern such as '
                '"year=*/part-*.parquet"'
            )
        if not args.input.startswith("s3://") or not args.input.endswith("/"):
            parser.error("--glob requires an s3:// prefix input ending with '/'")
    if args.manifest:
        if args.format != "parquet":
            parser.error("--manifest requires --format parquet")
        if not PARQUET_SET_MANIFEST_URI.fullmatch(args.manifest):
            parser.error(
                '--manifest must be an s3:// URI of a .json object such as '
                '"s3://reports/sales/manifest.json"'
            )
        if not args.input.startswith("s3://") or not args.input.endswith("/"):
            parser.error("--manifest requires an s3:// prefix input ending with '/'")
    try:
        payload = profile(
            args.input,
            args.source_id,
            args.format,
            args.auth,
            args.include_values,
            env_with_dotenv(),
            args.region,
            args.endpoint,
            args.glob,
            args.manifest,
        )
    except Exception as error:
        message = str(error)
        safe = message.replace(str(Path(args.input).resolve()), "<input>").replace(args.input, "<input>")
        for name, value in env_with_dotenv().items():
            if name.startswith(ENV_PREFIX) and value:
                safe = safe.replace(value, "<redacted>")
        print(f"cannot profile source {args.source_id!r} as {args.format}: {safe}", file=sys.stderr)
        return 1
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

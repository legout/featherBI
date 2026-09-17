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


def s3_credentials(source_id, values, region=None, endpoint=None):
    """Resolve S3 credentials for one source; raise with the required secret named."""
    def get(name):
        return values.get(f"{ENV_PREFIX}{name}", "")

    key_id = get("KEY_ID")
    secret = get("SECRET")
    if not key_id or not secret:
        raise ValueError(
            f"source {source_id!r} requires S3 credentials; set {ENV_PREFIX}KEY_ID "
            f"and {ENV_PREFIX}SECRET in the process environment or in a gitignored "
            ".env file (see .env.example), or configure the AWS credential chain"
        )
    region = region or get("REGION")
    endpoint = endpoint or get("ENDPOINT")
    options = [f"KEY_ID {sql_literal(key_id)}", f"SECRET {sql_literal(secret)}"]
    for value, sql_name in (
        (get("SESSION_TOKEN"), "SESSION_TOKEN"),
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
    return " ".join(options)


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
    if auth != "s3":
        return
    if credential_chain_secret(con):
        return
    con.execute(
        "CREATE OR REPLACE TEMPORARY SECRET fthr_s3 "
        f"(TYPE s3, PROVIDER config, {s3_credentials(source_id, secret_values, region, endpoint)})"
    )


def value_json(value):
    if value is None or isinstance(value, (int, float, bool)):
        return value
    text = str(value)
    return text if len(text) <= MAX_TEXT_LENGTH else text[:MAX_TEXT_LENGTH] + "…"


def profile(input_path, source_id, format_name, auth="none", include_values=False, secret_values=None, region=None, endpoint=None):
    remote = is_remote(input_path)
    size = None if remote else os.path.getsize(input_path)
    con = duckdb.connect(":memory:")
    con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")
    con.execute(f"SET threads={THREADS}")
    con.execute("SET preserve_insertion_order=false")
    if remote:
        configure_remote(con, input_path, source_id, auth, secret_values or {}, region, endpoint)
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
    return {
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--format", required=True, choices=("csv", "json", "ndjson", "parquet"))
    parser.add_argument("--auth", choices=("none", "s3"), default="none", help="s3 requires credentials via the AWS chain or FTHR_S3_* .env variables")
    parser.add_argument("--region")
    parser.add_argument("--endpoint")
    parser.add_argument("--include-values", action="store_true", help="include bounded ranges/top values after user permission")
    parser.add_argument("--output")
    args = parser.parse_args()
    if not SOURCE_ID.fullmatch(args.source_id):
        parser.error("--source-id must match ^[a-z][a-z0-9_]*$")
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

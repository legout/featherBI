#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==1.5.5"]
# ///
"""Emit a bounded DuckDB profile without paths or raw values by default."""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import duckdb

MAX_COLUMNS = 100
MAX_TEXT_LENGTH = 256
TOP_LIMIT = 5
SOURCE_ID = re.compile(r"^[a-z][a-z0-9_]*$")
LOW_CARDINALITY_LIMIT = 1000
MEMORY_LIMIT = "512MB"
THREADS = 4


def identifier(name):
    return '"' + name.replace('"', '""') + '"'


def read_relation(con, input_path, format_name):
    if format_name == "csv":
        return con.read_csv(input_path)
    if format_name == "json":
        return con.read_json(input_path, format="array")
    if format_name == "ndjson":
        return con.read_json(input_path, format="newline_delimited")
    return con.read_parquet(input_path)


def value_json(value):
    if value is None or isinstance(value, (int, float, bool)):
        return value
    text = str(value)
    return text if len(text) <= MAX_TEXT_LENGTH else text[:MAX_TEXT_LENGTH] + "…"


def profile(input_path, source_id, format_name, include_values=False):
    size = os.path.getsize(input_path)
    con = duckdb.connect(":memory:")
    con.execute(f"SET memory_limit='{MEMORY_LIMIT}'")
    con.execute(f"SET threads={THREADS}")
    con.execute("SET preserve_insertion_order=false")
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
    parser.add_argument("--include-values", action="store_true", help="include bounded ranges/top values after user permission")
    parser.add_argument("--output")
    args = parser.parse_args()
    if not SOURCE_ID.fullmatch(args.source_id):
        parser.error("--source-id must match ^[a-z][a-z0-9_]*$")
    try:
        payload = profile(args.input, args.source_id, args.format, args.include_values)
    except Exception as error:
        safe = str(error).replace(str(Path(args.input).resolve()), "<input>").replace(args.input, "<input>")
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

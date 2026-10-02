#!/usr/bin/env python3
"""Reproducible synthetic fixture generation for featherBI Plan 01 / P1.3.

Run exactly as `uv run tests/fixtures/generate.py` (the npm `fixtures` script).
The inline script metadata pins duckdb==1.5.5; generation fails loudly when uv
or the pinned DuckDB is unavailable. No format substitution: Parquet outputs
are always written via DuckDB. No private data: every byte written here is
synthetic and derived from the committed canonical fixtures.

Outputs under .artifacts/fixtures/:
  - parity set: inspections.csv / .json / .ndjson / .parquet, products.parquet
  - the bounded negative and boundary fixtures enumerated in expected.json
  - manifest.json with per-file digests, row counts, declared source schemas,
    expected outcomes, and the generator identity

Every output is verified against tests/fixtures/rows.json (the canonical
normalized form) and tests/fixtures/expected.json (independently authored
expectations) before the manifest records it as verified. Re-running the
script replaces only these known outputs and converges byte-for-byte.
"""

# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==1.5.5"]
# ///

from __future__ import annotations

import hashlib
import json
import platform
import re
import shutil
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import NoReturn

try:
    import duckdb
except ImportError as error:  # pragma: no cover - exercised only without uv
    raise SystemExit(
        "generate.py: duckdb is unavailable; run via `uv run tests/fixtures/generate.py` "
        "(inline metadata pins duckdb==1.5.5)"
    ) from error

DUCKDB_PIN = "1.5.5"
GENERATOR_COMMAND = "uv run tests/fixtures/generate.py"
CHART_FIRST_DAY = date(2026, 1, 1)
CHART_ROWS = 10001
TABLE_ROWS = 205

NUMERIC_LIKE = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$")
AMBIGUOUS_WORDS = {"true", "false", "null"}

if duckdb.__version__ != DUCKDB_PIN:
    raise SystemExit(
        f"generate.py: duckdb=={DUCKDB_PIN} is required, found {duckdb.__version__}"
    )


def fail(message: str) -> NoReturn:
    raise SystemExit(f"generate.py: {message}")


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sql_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def check_identifier(name: str, where: str) -> None:
    """Allowlist validation: SQL identifiers cannot be bound parameters, so
    every identifier used in runtime-owned SQL must match a strict pattern."""
    if not IDENTIFIER.match(name):
        fail(f"unsafe SQL identifier in {where}: {name!r}")


def duckdb_type(declared: str) -> str:
    return {
        "string": "VARCHAR",
        "boolean": "BOOLEAN",
        "integer": "BIGINT",
        "number": "DOUBLE",
        "date": "DATE",
        "timestamp": "TIMESTAMP",
    }[declared]


def to_python(value, declared: str):
    """Convert a canonical JSON value to the Python value DuckDB binds."""
    if value is None:
        return None
    if declared == "timestamp":
        return datetime.fromisoformat(value)
    return value


def iso_timestamp(moment: datetime) -> str:
    text = moment.strftime("%Y-%m-%dT%H:%M:%S")
    if moment.microsecond:
        text += f".{moment.microsecond:06d}"
    return text


def needs_quotes(value: str) -> bool:
    if any(ch in value for ch in (",", '"', "\n", "\r")):
        return True
    if value != value.strip():
        return True
    if NUMERIC_LIKE.match(value):
        return True
    if re.match(r"^\d{4}-", value):
        return True
    return value in AMBIGUOUS_WORDS


def csv_field(value, declared: str) -> str:
    if value is None:
        return ""
    if declared == "boolean":
        return "true" if value else "false"
    if declared == "timestamp":
        return value
    if value == "":
        return '""'
    if needs_quotes(value):
        return '"' + value.replace('"', '""') + '"'
    return value


def write_canonical_csv(
    path: Path, rows: list[dict], columns: list[tuple[str, str]]
) -> None:
    lines = [",".join(name for name, _ in columns)]
    for row in rows:
        lines.append(
            ",".join(csv_field(row[name], declared) for name, declared in columns)
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def parse_csv(text: str) -> list[list[tuple[bool, str]]]:
    """RFC 4180 parser preserving the quoted/unquoted field distinction."""
    records: list[list[tuple[bool, str]]] = []
    record: list[tuple[bool, str]] = []
    field = ""
    quoted = False
    in_quotes = False
    index = 0
    while index < len(text):
        ch = text[index]
        if in_quotes:
            if ch == '"':
                if index + 1 < len(text) and text[index + 1] == '"':
                    field += '"'
                    index += 2
                    continue
                in_quotes = False
                index += 1
                continue
            field += ch
            index += 1
            continue
        if ch == '"' and field == "" and not quoted:
            in_quotes = True
            quoted = True
            index += 1
            continue
        if ch == ",":
            record.append((quoted, field))
            field = ""
            quoted = False
            index += 1
            continue
        if ch in "\r\n":
            if ch == "\r" and index + 1 < len(text) and text[index + 1] == "\n":
                index += 1
            record.append((quoted, field))
            records.append(record)
            record = []
            field = ""
            quoted = False
            index += 1
            continue
        field += ch
        index += 1
    if field != "" or quoted or record:
        record.append((quoted, field))
        records.append(record)
    return records


def normalize_parsed(quoted: bool, value: str, declared: str):
    if not quoted and value == "":
        return None
    if declared == "boolean":
        if value == "true":
            return True
        if value == "false":
            return False
        fail(f"invalid boolean literal in generated CSV: {value!r}")
    if declared == "timestamp":
        return value.replace(" ", "T")
    return value


def verify_csv(path: Path, rows: list[dict], columns: list[tuple[str, str]]) -> None:
    records = parse_csv(path.read_text(encoding="utf-8"))
    if len(records) != len(rows) + 1:
        fail(
            f"{path.name}: expected header + {len(rows)} rows, found {len(records)} records"
        )
    header = [value for _, value in records[0]]
    if header != [name for name, _ in columns]:
        fail(f"{path.name}: header {header} does not match canonical columns")
    for row_index, record in enumerate(records[1:]):
        if len(record) != len(columns):
            fail(
                f"{path.name}: row {row_index} has {len(record)} fields, expected {len(columns)}"
            )
        for (name, declared), (quoted, value) in zip(columns, record, strict=True):
            got = normalize_parsed(quoted, value, declared)
            if got != rows[row_index][name]:
                fail(
                    f"{path.name}: row {row_index} column {name}: "
                    f"parsed {got!r} != canonical {rows[row_index][name]!r}"
                )


def verify_json_rows(
    path: Path,
    parsed_rows: list[dict],
    rows: list[dict],
    columns: list[tuple[str, str]],
) -> None:
    if len(parsed_rows) != len(rows):
        fail(f"{path.name}: expected {len(rows)} rows, found {len(parsed_rows)}")
    for row_index, parsed in enumerate(parsed_rows):
        for name, declared in columns:
            got = parsed.get(name)
            if declared == "timestamp" and isinstance(got, str):
                got = got.replace(" ", "T")
            if got != rows[row_index][name]:
                fail(
                    f"{path.name}: row {row_index} column {name}: "
                    f"parsed {got!r} != canonical {rows[row_index][name]!r}"
                )


def verify_parquet(
    connection, path: Path, rows: list[dict], columns: list[tuple[str, str]]
) -> None:
    # Bound parameter for the path; columns come back in table order, which
    # create_table built from the same schema order used for `columns`.
    fetched = connection.execute(
        "SELECT * FROM read_parquet(?)", [str(path)]
    ).fetchall()
    if len(fetched) != len(rows):
        fail(f"{path.name}: expected {len(rows)} rows, found {len(fetched)}")
    for row_index, got_row in enumerate(fetched):
        if len(got_row) != len(columns):
            fail(
                f"{path.name}: row {row_index} has {len(got_row)} columns, expected {len(columns)}"
            )
        for (name, declared), got in zip(columns, got_row, strict=True):
            want = rows[row_index][name]
            if declared == "timestamp":
                got = None if got is None else iso_timestamp(got)
            elif declared == "date" and isinstance(got, date):
                got = got.isoformat()
            if got != want:
                fail(
                    f"{path.name}: row {row_index} column {name}: "
                    f"read back {got!r} != canonical {want!r}"
                )


# --- Iceberg v2 table fixture (spec 2026-09-28-0004 §2.2, LT-05/LT-08) -----
#
# DuckDB 1.5.5 reads Iceberg but cannot write tables with delete files, so the
# live-iceberg browser fixture is hand-crafted: one unpartitioned table with a
# data file holding rows A/B/C and a positional-delete file deleting B. The
# Avro manifests embed the exact schemas DuckDB itself writes (extracted from
# a COPY (FORMAT ICEBERG) table on the pinned build), so the pinned iceberg
# extension parses them. The table is addressed by fixed s3:// URIs; the
# browser test serves it from a localhost S3-style endpoint.

ICEBERG_BUCKET_TABLE = "s3://reports/orders"
ICEBERG_SNAPSHOT_DELETED = 555_000_001  # data + positional deletes: rows A, C
ICEBERG_SNAPSHOT_FULL = 555_000_002  # data only: rows A, B, C ("newer" table)

# Wire schema of one manifest entry, matching the pinned DuckDB build's own
# COPY (FORMAT ICEBERG) output (content/file_path/file_format/partition/
# record_count/file_size_in_bytes/lower_bounds/upper_bounds/null_value_counts/
# equality_ids; Iceberg's logical "map" = array of kv records on the wire).
ICEBERG_MANIFEST_SCHEMA = {
    "type": "record",
    "name": "manifest_entry",
    "fields": [
        {"name": "status", "type": {"type": "int"}, "field-id": 0},
        {"name": "snapshot_id", "type": ["null", {"type": "long"}], "field-id": 1},
        {"name": "sequence_number", "type": ["null", {"type": "long"}], "field-id": 3},
        {"name": "file_sequence_number", "type": ["null", {"type": "long"}], "field-id": 4},
        {
            "name": "data_file",
            "type": {
                "type": "record",
                "name": "data_file",
                "fields": [
                    {
                        "name": "content",
                        "type": {"type": "int"},
                        "field-id": 134,
                    },
                    {"name": "file_path", "type": {"type": "string"}, "field-id": 100},
                    {"name": "file_format", "type": {"type": "string"}, "field-id": 101},
                    {
                        "name": "partition",
                        "type": {
                            "type": "record",
                            "name": "partition",
                            "fields": [],
                        },
                        "field-id": 102,
                    },
                    {"name": "record_count", "type": {"type": "long"}, "field-id": 103},
                    {
                        "name": "file_size_in_bytes",
                        "type": {"type": "long"},
                        "field-id": 104,
                    },
                    {
                        "name": "lower_bounds",
                        "type": [
                            "null",
                            {
                                "type": "array",
                                "logicalType": "map",
                                "items": {
                                    "type": "record",
                                    "name": "k126_v127",
                                    "fields": [
                                        {
                                            "name": "key",
                                            "type": {"type": "int"},
                                            "field-id": 126,
                                        },
                                        {
                                            "name": "value",
                                            "type": {"type": "bytes"},
                                            "field-id": 127,
                                        },
                                    ],
                                },
                            },
                        ],
                        "field-id": 125,
                    },
                    {
                        "name": "upper_bounds",
                        "type": [
                            "null",
                            {
                                "type": "array",
                                "logicalType": "map",
                                "items": {
                                    "type": "record",
                                    "name": "k129_v130",
                                    "fields": [
                                        {
                                            "name": "key",
                                            "type": {"type": "int"},
                                            "field-id": 129,
                                        },
                                        {
                                            "name": "value",
                                            "type": {"type": "bytes"},
                                            "field-id": 130,
                                        },
                                    ],
                                },
                            },
                        ],
                        "field-id": 128,
                    },
                    {
                        "name": "null_value_counts",
                        "type": [
                            "null",
                            {
                                "type": "array",
                                "logicalType": "map",
                                "items": {
                                    "type": "record",
                                    "name": "k121_v122",
                                    "fields": [
                                        {
                                            "name": "key",
                                            "type": {"type": "int"},
                                            "field-id": 121,
                                        },
                                        {
                                            "name": "value",
                                            "type": {"type": "long"},
                                            "field-id": 122,
                                        },
                                    ],
                                },
                            },
                        ],
                        "field-id": 110,
                    },
                    {
                        "name": "equality_ids",
                        "type": [
                            "null",
                            {
                                "type": "array",
                                "element-id": 136,
                                "items": {"type": "int"},
                            },
                        ],
                        "field-id": 135,
                    },
                ],
            },
            "field-id": 2,
        },
    ],
}

ICEBERG_MANIFEST_LIST_SCHEMA = {
    "type": "record",
    "name": "manifest_file",
    "fields": [
        {"name": "manifest_path", "type": {"type": "string"}, "field-id": 500},
        {"name": "manifest_length", "type": {"type": "long"}, "field-id": 501},
        {"name": "partition_spec_id", "type": {"type": "int"}, "field-id": 502},
        {"name": "content", "type": {"type": "int"}, "field-id": 517},
        {"name": "sequence_number", "type": {"type": "long"}, "field-id": 515},
        {"name": "min_sequence_number", "type": {"type": "long"}, "field-id": 516},
        {"name": "added_snapshot_id", "type": {"type": "long"}, "field-id": 503},
        {"name": "added_files_count", "type": {"type": "int"}, "field-id": 504},
        {"name": "existing_files_count", "type": {"type": "int"}, "field-id": 505},
        {"name": "deleted_files_count", "type": {"type": "int"}, "field-id": 506},
        {"name": "added_rows_count", "type": {"type": "long"}, "field-id": 512},
        {"name": "existing_rows_count", "type": {"type": "long"}, "field-id": 513},
        {"name": "deleted_rows_count", "type": {"type": "long"}, "field-id": 514},
        {
            "name": "partitions",
            "type": [
                "null",
                {
                    "type": "array",
                    "element-id": 508,
                    "items": {
                        "type": "record",
                        "name": "r508",
                        "fields": [
                            {
                                "name": "contains_null",
                                "type": {"type": "boolean"},
                                "field-id": 509,
                            },
                            {
                                "name": "contains_nan",
                                "type": ["null", {"type": "boolean"}],
                                "field-id": 518,
                            },
                            {
                                "name": "lower_bound",
                                "type": ["null", {"type": "bytes"}],
                                "field-id": 510,
                            },
                            {
                                "name": "upper_bound",
                                "type": ["null", {"type": "bytes"}],
                                "field-id": 511,
                            },
                        ],
                    },
                },
            ],
            "field-id": 507,
        },
    ],
}


def avro_long(value: int) -> bytes:
    """Zig-zag varint encoding of one Avro long/int."""
    if value >= 0:
        n = (value << 1) & 0xFFFFFFFFFFFFFFFF
    else:
        n = ((value << 1) ^ (-value - 1)) & 0xFFFFFFFFFFFFFFFF
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        if n:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def avro_string(value: str) -> bytes:
    raw = value.encode()
    return avro_long(len(raw)) + raw


def avro_bytes(value: bytes) -> bytes:
    return avro_long(len(value)) + value


def avro_map(pairs: list[tuple[int, bytes]] | None) -> bytes:
    """Iceberg's logical map (array of kv records) as a null-able union."""
    if pairs is None:
        return avro_long(0)  # union branch 0: null
    return (
        avro_long(1)
        + avro_long(len(pairs))
        + b"".join(avro_long(key) + avro_bytes(value) for key, value in pairs)
        + avro_long(0)
    )


def avro_container(
    schema: dict, records: list[bytes], metadata: dict[str, str], sync: bytes
) -> bytes:
    """One single-block null-codec Avro object container file."""
    header = {
        "avro.schema": json.dumps(schema, separators=(",", ":")).encode(),
        "avro.codec": b"null",
        **{key: value.encode() for key, value in metadata.items()},
    }
    out = bytearray(b"Obj\x01")
    out += avro_long(len(header))
    for key, value in header.items():
        out += avro_string(key)
        out += avro_bytes(value)
    out += avro_long(0) + sync
    body = b"".join(records)
    out += avro_long(len(records)) + avro_long(len(body)) + body + sync
    return bytes(out)


def iceberg_manifest_entry(
    *,
    content: int,
    file_path: str,
    record_count: int,
    file_size: int,
    lower: tuple[bytes, bytes],
    upper: tuple[bytes, bytes],
) -> bytes:
    """One ADDED manifest entry for an unpartitioned v2 table.

    `lower`/`upper` are the per-column bound pairs (id bytes, n little-endian
    int64); DuckDB prunes files by these bounds, so they must bracket the
    file's real values or scans silently drop rows.
    """
    data_file = (
        avro_long(content)
        + avro_string(file_path)
        + avro_string("parquet")
        + b""  # unpartitioned struct: no fields
        + avro_long(record_count)
        + avro_long(file_size)
        + avro_map([(1, lower[0]), (2, lower[1])])
        + avro_map([(1, upper[0]), (2, upper[1])])
        + avro_map([(1, b"\x00" * 8), (2, b"\x00" * 8)])
    )
    return (
        avro_long(1)  # status: ADDED
        + avro_long(0)  # snapshot_id: null
        + avro_long(0)  # sequence_number: null
        + avro_long(0)  # file_sequence_number: null
        + data_file
    )


def iceberg_manifest_list_entry(
    *, path: str, length: int, content: int, snapshot_id: int, rows: int
) -> bytes:
    return (
        avro_string(path)
        + avro_long(length)
        + avro_long(0)  # partition_spec_id
        + avro_long(content)
        + avro_long(1)  # sequence_number
        + avro_long(0)  # min_sequence_number
        + avro_long(snapshot_id)
        + avro_long(1)  # added_files_count
        + avro_long(0)  # existing_files_count
        + avro_long(0)  # deleted_files_count
        + avro_long(rows)  # added_rows_count
        + avro_long(0)  # existing_rows_count
        + avro_long(0)  # deleted_rows_count
        + avro_long(0)  # partitions: null
    )


def iceberg_metadata_document(
    *, location: str, snapshot_id: int, manifest_list: str, operation_summary: dict[str, str]
) -> str:
    """One minimal Iceberg v2 metadata document pinned to one snapshot."""
    schema = {
        "type": "struct",
        "schema-id": 0,
        "identifier-field-ids": [],
        "fields": [
            {"id": 1, "name": "id", "required": False, "type": "string"},
            {"id": 2, "name": "n", "required": False, "type": "long"},
        ],
    }
    timestamp = 1_767_139_200_000
    return json.dumps(
        {
            "format-version": 2,
            "table-uuid": f"9c12d18a-9f3e-4d92-b6c1-{snapshot_id:012d}",
            "location": location,
            "last-sequence-number": 1,
            "last-updated-ms": timestamp,
            "last-column-id": 2,
            "schemas": [schema],
            "current-schema-id": 0,
            "partition-specs": [{"spec-id": 0, "fields": []}],
            "default-spec-id": 0,
            "last-partition-id": 999,
            "properties": {},
            "current-snapshot-id": snapshot_id,
            "snapshots": [
                {
                    "snapshot-id": snapshot_id,
                    "timestamp-ms": timestamp,
                    "sequence-number": 1,
                    "schema-id": 0,
                    "manifest-list": manifest_list,
                    "summary": {"operation": "append", **operation_summary},
                }
            ],
            "snapshot-log": [{"snapshot-id": snapshot_id, "timestamp-ms": timestamp}],
            "metadata-log": [],
            "sort-orders": [{"order-id": 0, "fields": []}],
            "default-sort-order-id": 0,
            "refs": {"main": {"snapshot-id": snapshot_id, "type": "branch"}},
        }
    )


def write_iceberg_fixture(connection, out_dir: Path) -> dict[str, int]:
    """Write and natively verify the live-iceberg browser fixture.

    The s3:// fixture is served unchanged from a localhost endpoint for the
    native verification, proving delete semantics with the same bytes the
    browser test will read.
    """
    iceberg_dir = out_dir / "iceberg"
    (iceberg_dir / "data").mkdir(parents=True, exist_ok=True)
    (iceberg_dir / "metadata").mkdir(parents=True, exist_ok=True)
    data_uri = f"{ICEBERG_BUCKET_TABLE}/data/00001.parquet"
    delete_uri = f"{ICEBERG_BUCKET_TABLE}/data/00001-delete.parquet"
    connection.execute(  # noqa: S608 - generator-controlled path
        "COPY (SELECT * FROM (VALUES ('A', 1::BIGINT), ('B', 2::BIGINT), ('C', 3::BIGINT)) t(id, n)) "
        f"TO {sql_string(str(iceberg_dir / 'data' / '00001.parquet'))} "
        "(FORMAT PARQUET, FIELD_IDS {'id': 1, 'n': 2})"
    )
    connection.execute(  # noqa: S608 - generator-controlled path
        f"COPY (SELECT {sql_string(data_uri)} AS path, 1::BIGINT AS pos) "
        f"TO {sql_string(str(iceberg_dir / 'data' / '00001-delete.parquet'))} "
        "(FORMAT PARQUET, FIELD_IDS {'path': 2147483546, 'pos': 2147483545})"
    )
    data_size = (iceberg_dir / "data" / "00001.parquet").stat().st_size
    delete_size = (iceberg_dir / "data" / "00001-delete.parquet").stat().st_size

    schema_meta = json.dumps(
        {
            "type": "struct",
            "schema-id": 0,
            "fields": [
                {"id": 1, "name": "id", "required": False, "type": "string"},
                {"id": 2, "name": "n", "required": False, "type": "long"},
            ],
        },
        separators=(",", ":"),
    )
    common_meta = {
        "partition-spec-id": "0",
        "format-version": "2",
        "schema": schema_meta,
        "schema-id": "0",
        "partition-spec": "[]",
    }
    data_manifest_uri = f"{ICEBERG_BUCKET_TABLE}/metadata/00001-m0.avro"
    delete_manifest_uri = f"{ICEBERG_BUCKET_TABLE}/metadata/00001-m1.avro"
    data_manifest = avro_container(
        ICEBERG_MANIFEST_SCHEMA,
        [
            iceberg_manifest_entry(
                content=0,
                file_path=data_uri,
                record_count=3,
                file_size=data_size,
                lower=(b"A", (1).to_bytes(8, "little")),
                upper=(b"C", (3).to_bytes(8, "little")),
            )
        ],
        {**common_meta, "content": "data"},
        b"\x01" * 16,
    )
    delete_manifest = avro_container(
        ICEBERG_MANIFEST_SCHEMA,
        [
            iceberg_manifest_entry(
                content=1,
                file_path=delete_uri,
                record_count=1,
                file_size=delete_size,
                lower=(delete_uri.encode(), (1).to_bytes(8, "little")),
                upper=(delete_uri.encode(), (1).to_bytes(8, "little")),
            )
        ],
        {**common_meta, "content": "deletes"},
        b"\x02" * 16,
    )
    (iceberg_dir / "metadata" / "00001-m0.avro").write_bytes(data_manifest)
    (iceberg_dir / "metadata" / "00001-m1.avro").write_bytes(delete_manifest)

    deleted_list = avro_container(
        ICEBERG_MANIFEST_LIST_SCHEMA,
        [
            iceberg_manifest_list_entry(
                path=data_manifest_uri,
                length=len(data_manifest),
                content=0,
                snapshot_id=ICEBERG_SNAPSHOT_DELETED,
                rows=3,
            ),
            iceberg_manifest_list_entry(
                path=delete_manifest_uri,
                length=len(delete_manifest),
                content=1,
                snapshot_id=ICEBERG_SNAPSHOT_DELETED,
                rows=1,
            ),
        ],
        {},
        b"\x03" * 16,
    )
    full_list = avro_container(
        ICEBERG_MANIFEST_LIST_SCHEMA,
        [
            iceberg_manifest_list_entry(
                path=data_manifest_uri,
                length=len(data_manifest),
                content=0,
                snapshot_id=ICEBERG_SNAPSHOT_FULL,
                rows=3,
            )
        ],
        {},
        b"\x04" * 16,
    )
    (iceberg_dir / "metadata" / "snap-555000001-00001.avro").write_bytes(deleted_list)
    (iceberg_dir / "metadata" / "snap-555000002-00001.avro").write_bytes(full_list)
    (iceberg_dir / "metadata" / "v1.metadata.json").write_text(
        iceberg_metadata_document(
            location=ICEBERG_BUCKET_TABLE,
            snapshot_id=ICEBERG_SNAPSHOT_DELETED,
            manifest_list=f"{ICEBERG_BUCKET_TABLE}/metadata/snap-555000001-00001.avro",
            operation_summary={
                "added-data-files": "1",
                "added-records": "3",
                "added-position-deletes": "1",
                "total-data-files": "1",
                "total-records": "3",
                "total-position-deletes": "1",
            },
        ),
        encoding="utf-8",
    )
    (iceberg_dir / "metadata" / "v2.metadata.json").write_text(
        iceberg_metadata_document(
            location=ICEBERG_BUCKET_TABLE,
            snapshot_id=ICEBERG_SNAPSHOT_FULL,
            manifest_list=f"{ICEBERG_BUCKET_TABLE}/metadata/snap-555000002-00001.avro",
            operation_summary={
                "added-data-files": "1",
                "added-records": "3",
                "total-data-files": "1",
                "total-records": "3",
            },
        ),
        encoding="utf-8",
    )
    return verify_iceberg_fixture(iceberg_dir)


def verify_iceberg_fixture(iceberg_dir: Path) -> dict[str, int]:
    """Serve the s3:// fixture from localhost and verify it with pinned native
    DuckDB: the raw data file holds three rows, the v1 snapshot applies the
    positional delete (two rows, B absent), and the v2 snapshot has no deletes
    (three rows). A wrong Avro/metadata byte fails the run loudly."""
    import http.server
    import threading

    class Handler(http.server.SimpleHTTPRequestHandler):
        def translate_path(self, path):
            relative = path.split("?", 1)[0].split("#", 1)[0]
            prefix = "/reports/orders/"
            if not relative.startswith(prefix):
                self.send_error(404)
                return ""
            return str(iceberg_dir / relative[len(prefix) :])

        def log_message(self, format, *args):
            pass

        def do_GET(self):
            # Minimal range support: DuckDB httpfs sends byte ranges.
            path = self.translate_path(self.path)
            if not path:
                return
            try:
                payload = Path(path).read_bytes()
            except OSError:
                self.send_error(404)
                return
            match = re.match(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
            if not match:
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            start = int(match.group(1))
            end = len(payload) - 1 if match.group(2) == "" else int(match.group(2))
            body = payload[start : end + 1]
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(payload)}")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_HEAD(self):
            path = self.translate_path(self.path)
            if not path:
                return
            try:
                size = Path(path).stat().st_size
            except OSError:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(size))
            self.end_headers()

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    with server:
        endpoint = f"127.0.0.1:{server.server_address[1]}"
        threading.Thread(target=server.serve_forever, daemon=True).start()
        con = duckdb.connect(":memory:")
        for extension in ("httpfs", "iceberg"):
            try:
                con.execute(f"LOAD {extension}")
            except duckdb.Error:
                con.execute(f"INSTALL {extension}")
                con.execute(f"LOAD {extension}")
        con.execute(
            "CREATE SECRET fthr_verify (TYPE s3, PROVIDER config, "
            f"ENDPOINT {sql_string(endpoint)}, URL_STYLE 'path', USE_SSL false)"
        )
        base = f"{ICEBERG_BUCKET_TABLE}/metadata"
        raw = con.execute(
            "SELECT count(*), bool_or(id = 'B') FROM read_parquet(?)",
            [f"{ICEBERG_BUCKET_TABLE}/data/00001.parquet"],
        ).fetchone()
        deleted = con.execute(
            "SELECT count(*), bool_or(id = 'B') FROM iceberg_scan(?)",
            [f"{base}/v1.metadata.json"],
        ).fetchone()
        full = con.execute(
            "SELECT count(*), bool_or(id = 'B') FROM iceberg_scan(?)",
            [f"{base}/v2.metadata.json"],
        ).fetchone()
        # A predicate read proves the manifest bounds bracket the real
        # values (wrong bounds prune live rows away silently).
        filtered = con.execute(
            "SELECT id FROM iceberg_scan(?) WHERE id = 'C'",
            [f"{base}/v1.metadata.json"],
        ).fetchall()
        con.close()
    if raw != (3, True):
        fail(f"iceberg fixture data file must hold rows A/B/C, got {raw}")
    if deleted != (2, False):
        fail(
            f"iceberg fixture v1 snapshot must apply the positional delete "
            f"(2 rows, no B), got {deleted}"
        )
    if full != (3, True):
        fail(f"iceberg fixture v2 snapshot must expose all three rows, got {full}")
    if filtered != [("C",)]:
        fail(
            f"iceberg fixture v1 predicate read must return row C, got {filtered}; "
            "the manifest bounds do not bracket the data file's values"
        )
    return {
        "rawRows": raw[0],
        "deletedSnapshotRows": deleted[0],
        "fullSnapshotRows": full[0],
    }


def create_table(connection, table: str, schema: dict) -> list[tuple[str, str]]:
    check_identifier(table, "table name")
    columns = [(name, spec["type"]) for name, spec in schema.items()]
    for name, _ in columns:
        check_identifier(name, f"table {table}")
    definitions = ", ".join(
        f"{sql_ident(name)} {duckdb_type(declared)}" for name, declared in columns
    )
    connection.execute(  # noqa: S608 - identifiers escaped by sql_ident
        f"CREATE TABLE {sql_ident(table)} ({definitions})"
    )
    return columns


def bind_tuples(rows: list[dict], columns: list[tuple[str, str]]) -> list[tuple]:
    return [
        tuple(to_python(row[name], declared) for name, declared in columns)
        for row in rows
    ]


def check_table_shape(table: str, columns: list[tuple[str, str]], width: int) -> None:
    check_identifier(table, "table name")
    for name, _ in columns:
        check_identifier(name, f"table {table}")
    if len(columns) != width:
        fail(
            f"table {table!r} declares {len(columns)} columns, "
            f"expected {width} for the allowlisted statement"
        )


def insert_inspections(
    connection, rows: list[dict], columns: list[tuple[str, str]]
) -> None:
    # Static allowlisted statement; the width invariant ties the placeholder
    # count to the runtime config schema declared for this source.
    check_table_shape("inspections", columns, 8)
    for source, order_number, station, sequence, code, mlfb, when, last in bind_tuples(
        rows, columns
    ):
        connection.execute(
            'INSERT INTO "inspections" VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [source, order_number, station, sequence, code, mlfb, when, last],
        )


def insert_products(
    connection, rows: list[dict], columns: list[tuple[str, str]]
) -> None:
    check_table_shape("products", columns, 2)
    for mlfb, label in bind_tuples(rows, columns):
        connection.execute('INSERT INTO "products" VALUES (?, ?)', [mlfb, label])


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def count_csv_data_rows(path: Path) -> int:
    return len(path.read_text(encoding="utf-8").splitlines()) - 1


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    fixtures_dir = root / "tests" / "fixtures"
    out_dir = root / ".artifacts" / "fixtures"

    rows = json.loads((fixtures_dir / "rows.json").read_text(encoding="utf-8"))
    products = json.loads((fixtures_dir / "products.json").read_text(encoding="utf-8"))
    expected = json.loads((fixtures_dir / "expected.json").read_text(encoding="utf-8"))
    config = json.loads(
        (fixtures_dir / "runtime.config.json").read_text(encoding="utf-8")
    )

    sources = {source["id"]: source for source in config["data"]["sources"]}
    if list(sources) != expected["configExpectations"]["sourceIds"]:
        fail(
            f"runtime.config.json source ids {list(sources)} do not match expectations"
        )
    connection = duckdb.connect()

    # --- parity set -------------------------------------------------------
    inspections_schema = sources["inspections"]["schema"]
    products_schema = sources["products"]["schema"]
    inspections_columns = create_table(connection, "inspections", inspections_schema)
    products_columns = create_table(connection, "products", products_schema)

    column_names = [name for name, _ in inspections_columns]
    for row in rows:
        if list(row) != column_names:
            fail(
                f"rows.json row keys {list(row)} do not match config schema order {column_names}"
            )
    for row in rows:
        for name, spec in inspections_schema.items():
            value = row[name]
            if value is None and not spec["nullable"]:
                fail(f"rows.json has null in non-nullable column {name}")
            if (
                value is not None
                and spec["type"] == "string"
                and not isinstance(value, str)
            ):
                fail(f"rows.json column {name} must hold strings")

    insert_inspections(connection, rows, inspections_columns)
    insert_products(connection, products, products_columns)

    known_outputs = [entry["file"] for entry in expected["negative"]]
    known_outputs += [entry["file"] for entry in expected["boundaryFixtures"]]
    known_outputs += [
        "inspections.csv",
        "inspections.json",
        "inspections.ndjson",
        "inspections.parquet",
        "products.parquet",
    ]
    iceberg_outputs = [
        "iceberg/data/00001.parquet",
        "iceberg/data/00001-delete.parquet",
        "iceberg/metadata/00001-m0.avro",
        "iceberg/metadata/00001-m1.avro",
        "iceberg/metadata/snap-555000001-00001.avro",
        "iceberg/metadata/snap-555000002-00001.avro",
        "iceberg/metadata/v1.metadata.json",
        "iceberg/metadata/v2.metadata.json",
    ]
    known_outputs += iceberg_outputs
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(out_dir / "iceberg", ignore_errors=True)
    for name in known_outputs:
        (out_dir / name).unlink(missing_ok=True)

    write_canonical_csv(out_dir / "inspections.csv", rows, inspections_columns)
    connection.execute(  # noqa: S608 - generator-controlled path
        f"COPY {sql_ident('inspections')} TO {sql_string(str(out_dir / 'inspections.json'))} "
        "(FORMAT JSON, ARRAY TRUE)"
    )
    connection.execute(  # noqa: S608 - generator-controlled path
        f"COPY {sql_ident('inspections')} TO {sql_string(str(out_dir / 'inspections.ndjson'))} "
        "(FORMAT JSON, ARRAY FALSE)"
    )
    connection.execute(  # noqa: S608 - generator-controlled path
        f"COPY {sql_ident('inspections')} TO {sql_string(str(out_dir / 'inspections.parquet'))} "
        "(FORMAT PARQUET)"
    )
    connection.execute(  # noqa: S608 - generator-controlled path
        f"COPY {sql_ident('products')} TO {sql_string(str(out_dir / 'products.parquet'))} "
        "(FORMAT PARQUET)"
    )

    parity_verified = {}
    verify_csv(out_dir / "inspections.csv", rows, inspections_columns)
    parity_verified["inspections.csv"] = True
    verify_json_rows(
        out_dir / "inspections.json",
        json.loads((out_dir / "inspections.json").read_text(encoding="utf-8")),
        rows,
        inspections_columns,
    )
    parity_verified["inspections.json"] = True
    ndjson_rows = [
        json.loads(line)
        for line in (out_dir / "inspections.ndjson")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip() != ""
    ]
    verify_json_rows(
        out_dir / "inspections.ndjson", ndjson_rows, rows, inspections_columns
    )
    parity_verified["inspections.ndjson"] = True
    verify_parquet(
        connection, out_dir / "inspections.parquet", rows, inspections_columns
    )
    parity_verified["inspections.parquet"] = True
    verify_parquet(connection, out_dir / "products.parquet", products, products_columns)
    parity_verified["products.parquet"] = True

    # --- negative fixtures ------------------------------------------------
    boundaries = {entry["file"]: entry for entry in expected["boundaryFixtures"]}
    (out_dir / "neg-invalid-date.csv").write_text(
        "event_date,note\n"
        "2026-01-15,ok\n"
        "2026-02-30,leap-day-invalid\n"
        "2026-04-31,april-31-invalid\n",
        encoding="utf-8",
    )
    (out_dir / "neg-timestamp-offset.csv").write_text(
        "recorded_at,note\n"
        "2026-01-01T10:00:00,naive-ok\n"
        "2026-01-02T10:00:00+02:00,offset-bearing\n",
        encoding="utf-8",
    )
    (out_dir / "neg-unsafe-integer.csv").write_text(
        "value,note\n"
        "42,ok\n"
        "9007199254740991,max-safe-integer-ok\n"
        "9007199254740993,unsafe-integer\n",
        encoding="utf-8",
    )
    malformed_lines = ["order_number,station,is_last_measurement"]
    stations = ["SJ", "SD", "SA"]
    for index in range(1, 503):
        flag = "MAYBE" if index == 502 else ("true" if index % 2 == 1 else "false")
        malformed_lines.append(f"F{index:06d},{stations[(index - 1) % 3]},{flag}")
    (out_dir / "neg-malformed-final-row.csv").write_text(
        "\n".join(malformed_lines) + "\n", encoding="utf-8"
    )
    (out_dir / "neg-duplicate-headers.csv").write_text(
        "station,station,records\nSJ,SD,3\n", encoding="utf-8"
    )
    (out_dir / "neg-case-colliding-headers.csv").write_text(
        "Station,station\nSJ,SD\n", encoding="utf-8"
    )
    (out_dir / "neg-nested-json.json").write_text(
        json.dumps(
            [
                {"order_number": "T0001", "payload": "ok"},
                {"order_number": "T0002", "payload": {"nested": True}},
                {"order_number": "T0003", "payload": ["a", "b"]},
            ],
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (out_dir / "neg-missing-column.csv").write_text("station\nSJ\n", encoding="utf-8")
    (out_dir / "neg-missing-key.ndjson").write_text(
        '{"order_number": "T0001", "station": "SJ"}\n'
        '{"order_number": "T0002", "station": "SD"}\n'
        '{"station": "SA"}\n',
        encoding="utf-8",
    )

    # --- boundary and valid-empty fixtures --------------------------------
    (out_dir / "ok-timestamp-microseconds.csv").write_text(
        "recorded_at\n2026-01-01T12:34:56.123456\n", encoding="utf-8"
    )
    (out_dir / "ok-safe-integers.csv").write_text(
        "value\n-9007199254740991\n9007199254740991\n", encoding="utf-8"
    )
    (out_dir / "ok-empty.csv").write_text(
        "order_number,station,is_last_measurement\n", encoding="utf-8"
    )
    (out_dir / "ok-empty.json").write_text("[]", encoding="utf-8")
    empty_schema = {
        name: {"type": declared, "nullable": True}
        for name, declared in boundaries["ok-empty.parquet"]["schema"].items()
    }
    create_table(connection, "empty_inspections", empty_schema)
    connection.execute(  # noqa: S608 - generator-controlled path
        f"COPY {sql_ident('empty_inspections')} TO "
        f"{sql_string(str(out_dir / 'ok-empty.parquet'))} (FORMAT PARQUET)"
    )
    row = connection.execute(
        "SELECT count(*) FROM read_parquet(?)", [str(out_dir / "ok-empty.parquet")]
    ).fetchone()
    if row is None or row[0] != 0:
        fail("ok-empty.parquet must contain zero rows")

    chart_lines = ["day,records"]
    for index in range(CHART_ROWS):
        chart_lines.append(
            f"{(CHART_FIRST_DAY + timedelta(days=index)).isoformat()},{index}"
        )
    (out_dir / "chart-10001.csv").write_text(
        "\n".join(chart_lines) + "\n", encoding="utf-8"
    )
    table_lines = ["rank,order_number,station,takt_seconds,flag"]
    station_cycle = ["SD", "SA", "SJ"]
    for rank in range(1, TABLE_ROWS + 1):
        table_lines.append(
            ",".join(
                [
                    str(rank),
                    f"R{rank:07d}",
                    station_cycle[rank % 3],
                    f"{60 + rank * 0.5:.1f}",
                    "true" if rank % 2 == 1 else "false",
                ]
            )
        )
    (out_dir / "table-205.csv").write_text(
        "\n".join(table_lines) + "\n", encoding="utf-8"
    )

    # --- live-iceberg fixture (written and natively verified) -------------
    iceberg_counts = write_iceberg_fixture(connection, out_dir)

    # --- self-checks against expected.json --------------------------------
    chart_expected = next(
        entry
        for entry in expected["boundaryFixtures"]
        if entry["file"] == "chart-10001.csv"
    )
    if chart_expected["dataRows"] != CHART_ROWS:
        fail("chart fixture row count disagrees with expected.json")
    if (
        chart_expected["lastDay"]
        != (CHART_FIRST_DAY + timedelta(days=CHART_ROWS - 1)).isoformat()
    ):
        fail("chart fixture last day disagrees with expected.json")
    if chart_expected["sum"] != sum(range(CHART_ROWS)):
        fail("chart fixture sum disagrees with expected.json")
    table_expected = next(
        entry
        for entry in expected["boundaryFixtures"]
        if entry["file"] == "table-205.csv"
    )
    if table_expected["dataRows"] != TABLE_ROWS:
        fail("table fixture row count disagrees with expected.json")
    if table_expected["taktLast"] != 60 + TABLE_ROWS * 0.5:
        fail("table fixture last takt disagrees with expected.json")

    for entry in expected["negative"]:
        path = out_dir / entry["file"]
        text = path.read_text(encoding="utf-8")
        if (
            entry["file"].endswith(".csv")
            and count_csv_data_rows(path) != entry["dataRows"]
        ):
            fail(f"{entry['file']} row count disagrees with expected.json")
        offending = entry["offending"]
        if isinstance(offending, str):
            if entry["reason"].startswith("missing-"):
                # Absence fixtures: the offending marker must NOT appear.
                if offending in text:
                    fail(f"{entry['file']} must be missing {offending!r}")
            elif offending not in text:
                fail(f"{entry['file']} must contain the offending marker {offending!r}")
    for entry in expected["boundaryFixtures"]:
        path = out_dir / entry["file"]
        if (
            entry["file"].endswith(".csv")
            and count_csv_data_rows(path) != entry["dataRows"]
        ):
            fail(f"{entry['file']} row count disagrees with expected.json")

    for marker in expected["privacy"]["forbiddenReferences"]:
        for name in known_outputs:
            text = (out_dir / name).read_text(encoding="utf-8", errors="replace")
            if marker in text:
                fail(f"{name} must not reference private AP data ({marker})")

    # --- manifest ----------------------------------------------------------
    files = []
    for name in [
        "inspections.csv",
        "inspections.json",
        "inspections.ndjson",
        "inspections.parquet",
    ]:
        files.append(
            {
                "name": name,
                "kind": "parity",
                "rows": expected["parity"]["rows"],
                "sha256": sha256_of(out_dir / name),
                "bytes": (out_dir / name).stat().st_size,
            }
        )
    files.append(
        {
            "name": "products.parquet",
            "kind": "parity",
            "rows": len(products),
            "sha256": sha256_of(out_dir / "products.parquet"),
            "bytes": (out_dir / "products.parquet").stat().st_size,
        }
    )
    for entry in expected["negative"]:
        path = out_dir / entry["file"]
        files.append(
            {
                "name": entry["file"],
                "kind": "negative",
                "rows": entry["dataRows"],
                "sha256": sha256_of(path),
                "bytes": path.stat().st_size,
                "expectedOutcome": entry["outcome"],
                "reason": entry["reason"],
                "offending": entry["offending"],
            }
        )
    for entry in expected["boundaryFixtures"]:
        path = out_dir / entry["file"]
        files.append(
            {
                "name": entry["file"],
                "kind": "boundary",
                "rows": entry["dataRows"],
                "sha256": sha256_of(path),
                "bytes": path.stat().st_size,
                "expectedOutcome": entry["outcome"],
            }
        )

    manifest = {
        "generator": {
            "command": GENERATOR_COMMAND,
            "duckdbPin": DUCKDB_PIN,
            "duckdbVersion": duckdb.__version__,
            "pythonVersion": platform.python_version(),
            "canonicalRows": "tests/fixtures/rows.json",
            "sources": {
                source["id"]: {
                    "type": source["type"],
                    "file": source["file"],
                    "schema": source["schema"],
                }
                for source in config["data"]["sources"]
            },
        },
        "parityVerified": parity_verified,
        "iceberg": {
            "files": iceberg_outputs,
            "nativeVerification": iceberg_counts,
        },
        "files": files,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    connection.close()
    print(f"generate.py: wrote {len(files)} fixtures + manifest.json to {out_dir}")
    print("generate.py: all parity outputs verified against tests/fixtures/rows.json")
    print(
        "generate.py: iceberg fixture verified natively: "
        f"raw rows {iceberg_counts['rawRows']}, deleted snapshot "
        f"{iceberg_counts['deletedSnapshotRows']}, full snapshot "
        f"{iceberg_counts['fullSnapshotRows']}"
    )


if __name__ == "__main__":
    if sys.version_info < (3, 11):
        fail("python >= 3.11 required")
    main()

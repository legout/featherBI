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
    out_dir.mkdir(parents=True, exist_ok=True)
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
        "files": files,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    connection.close()
    print(f"generate.py: wrote {len(files)} fixtures + manifest.json to {out_dir}")
    print("generate.py: all parity outputs verified against tests/fixtures/rows.json")


if __name__ == "__main__":
    if sys.version_info < (3, 11):
        fail("python >= 3.11 required")
    main()

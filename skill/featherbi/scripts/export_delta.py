#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==1.5.5"]
# ///
"""Export one local Delta table snapshot for a live Parquet set (spec
2026-10-19-0005 §4 / SL-05).

The pinned native DuckDB 1.5.5 with the official Delta extension is read-only
(ADR 0010 E2), so export means delta_scan of the current snapshot into fresh
``<export-id>/part-NNN.parquet`` files plus the public root ``manifest.json``
``{"files": [...]}`` and an ``export.json`` sidecar (Delta version, export
time). A re-export writes new part files and overwrites only those two root
files; part files are never rewritten. featherBI never uploads; errors stay
free of local paths and secrets.
"""

import argparse
import json
import re
import time
import uuid
from pathlib import Path

import duckdb  # pyright: ignore[reportMissingImports] # resolved by `uv run --script` from the PEP 723 block above

REMOTE_INPUT = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)
DELTA_COMMIT = re.compile(r"^(\d{20})\.json$")


def fail(message):
    raise SystemExit(f"export delta: {message}")


def current_delta_version(table):
    """Highest 20-digit commit number in _delta_log; raises without paths."""
    log = table / "_delta_log"
    if not log.is_dir():
        fail("input has no _delta_log directory; it is not a Delta table location")
    versions = [
        int(match.group(1))
        for match in (DELTA_COMMIT.match(entry.name) for entry in log.iterdir())
        if match
    ]
    if not versions:
        fail("input has no _delta_log commit files; it is not a Delta table location")
    return max(versions)


def export_parts(con, table, target):
    """COPY the current snapshot into target/ as data_N.parquet files."""
    # Threads stay bounded so PER_THREAD_OUTPUT yields a bounded part count
    # (S3 evidence: project/research/delta-native-export-probe.md).
    con.execute("SET threads=4")
    # Both dynamic values reach DuckDB as a bound parameter or a session
    # variable; the statement text itself stays static.
    con.execute("SET VARIABLE featherbi_export_target = ?", [str(target)])
    con.execute(
        "COPY (SELECT * FROM delta_scan(?)) "
        "TO (getvariable('featherbi_export_target')) "
        "(FORMAT PARQUET, PER_THREAD_OUTPUT true)",
        [str(table)],
    )


def main():
    parser = argparse.ArgumentParser(prog="featherbi export delta")
    parser.add_argument("--input", required=True, help="local Delta table location")
    parser.add_argument("--output", required=True, help="export output directory")
    args = parser.parse_args()
    if REMOTE_INPUT.match(args.input):
        fail("--input must be a local Delta table location, not a remote URI")
    table = Path(args.input)
    if not table.is_dir():
        fail("--input is not a readable directory")
    version = current_delta_version(table)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    # gmtime is UTC by definition; the sidecar keeps the S3 evidence format
    # (for example "2026-10-19T14:23:40+00:00").
    moment = time.gmtime()
    exported_at = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", moment)
    day = time.strftime("%Y%m%d", moment)
    while True:
        export_id = f"exp-{day}-{uuid.uuid4().hex[:4]}"
        target = output / export_id
        if not target.exists():
            break
    con = duckdb.connect()
    try:
        con.execute("LOAD delta")
    except duckdb.Error:
        fail("the DuckDB Delta extension is not installed; featherbi does not download it")
    try:
        export_parts(con, table, target)
    except duckdb.Error:
        fail("delta_scan cannot read the input; verify it is a readable Delta table")
    parts = sorted(
        target.glob("data_*.parquet"),
        key=lambda part: int(part.stem.removeprefix("data_")),
    )
    files = []
    for index, part in enumerate(parts):
        name = f"part-{index:03d}.parquet"
        part.rename(target / name)
        files.append(f"{export_id}/{name}")
    (output / "manifest.json").write_text(
        json.dumps({"files": files}) + "\n", encoding="utf-8"
    )
    (output / "export.json").write_text(
        json.dumps({"delta_version": version, "exported_at": exported_at}) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {"export_id": export_id, "parts": len(files), "delta_version": version}
        )
    )


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        # No tracebacks: they would leak local paths (output privacy rule).
        fail("export failed while writing the output; no previous part files were touched")

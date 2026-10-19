#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==1.5.5"]
# ///
"""Export one Delta table snapshot for a live Parquet set (spec
2026-10-19-0005 §4 / SL-05).

The pinned native DuckDB 1.5.5 with the official Delta extension is read-only
(ADR 0010 E2), so export means delta_scan of one snapshot into fresh
``<export-id>/part-NNN.parquet`` files plus the public root ``manifest.json``
``{"files": [...]}`` and an ``export.json`` sidecar (Delta version, export
time). The input is a local directory or a remote location native DuckDB can
read; S3 credentials follow the existing author conventions (AWS chain, then
gitignored ``.env``). The version recorded in the sidecar is discovered and
the scan pinned to it through the same engine, so a commit landing between
discovery and the scan can never publish data the sidecar misidentifies. A
re-export writes new part files and overwrites only those two root files;
part files are never rewritten. featherBI never uploads; errors stay free of
local paths and secrets.
"""

import argparse
import json
import time
import uuid
from pathlib import Path
from typing import NoReturn

import duckdb  # pyright: ignore[reportMissingImports] # resolved by `uv run --script` from the PEP 723 block above
from remote_common import configure_remote, env_with_dotenv, is_remote  # pyright: ignore[reportMissingImports] # sibling of this script

DELTA_COMMIT_SQL = r"(\d{20})\.json$"


def fail(message) -> NoReturn:
    raise SystemExit(f"export delta: {message}")


def current_delta_version(con, table):
    """Highest 20-digit commit in `_delta_log`, read through the same engine
    that will scan, so the pin and the snapshot agree for local and remote
    locations alike."""
    try:
        row = con.execute(
            "SELECT max(CAST(regexp_extract(file, ?, 1) AS BIGINT)) FROM glob(?) "
            "WHERE regexp_extract(file, ?, 1) <> ''",
            [DELTA_COMMIT_SQL, f"{table}/_delta_log/*.json", DELTA_COMMIT_SQL],
        ).fetchone()
    except duckdb.Error:
        fail(
            "cannot list the input's _delta_log; verify it is a readable "
            "Delta table and any remote credentials are configured"
        )
    if row is None or row[0] is None:
        fail("input has no readable _delta_log commit files; it is not a Delta table location")
    return int(row[0])


def export_parts(con, table, target, version):
    """COPY the pinned snapshot into target/ as data_N.parquet files."""
    # Threads stay bounded so PER_THREAD_OUTPUT yields a bounded part count
    # (S3 evidence: project/research/delta-native-export-probe.md).
    con.execute("SET threads=4")
    # Both dynamic values reach DuckDB as a bound parameter or a session
    # variable; the statement text itself stays static.
    con.execute("SET VARIABLE featherbi_export_target = ?", [str(target)])
    # The scan is pinned to the recorded version: a commit landing between
    # discovery and this COPY changes the table's head, never this export.
    con.execute(
        "COPY (SELECT * FROM delta_scan(?, version := ?)) "
        "TO (getvariable('featherbi_export_target')) "
        "(FORMAT PARQUET, PER_THREAD_OUTPUT true)",
        [str(table), version],
    )


def main():
    parser = argparse.ArgumentParser(prog="featherbi export delta")
    parser.add_argument(
        "--input",
        required=True,
        help="local directory or native-readable remote Delta table location",
    )
    parser.add_argument("--output", required=True, help="local export output directory")
    args = parser.parse_args()
    remote_input = is_remote(args.input)
    table = args.input if remote_input else Path(args.input)
    if isinstance(table, str):
        table = table.rstrip("/")
    elif not table.is_dir():
        fail("--input is not a readable directory")
    output = Path(args.output)
    con = duckdb.connect()
    try:
        con.execute("LOAD delta")
    except duckdb.Error:
        fail("the DuckDB Delta extension is not installed; featherbi does not download it")
    if remote_input:
        auth = "s3" if args.input.lower().startswith("s3://") else "none"
        try:
            configure_remote(con, "export delta", auth, env_with_dotenv())
        except ValueError as error:
            fail(str(error))
    version = current_delta_version(con, table)
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
    try:
        export_parts(con, table, target, version)
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

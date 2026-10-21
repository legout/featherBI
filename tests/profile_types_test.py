"""Focused test for the profiler's featherBI column types (ticket #46).

Failure mode: a wrong type reaches the typed view. The profile report must
carry only the six schema types from authoring/schema.json
(definitions.columnType), and an unmapped DuckDB type must fail loudly with
the column name and a remedy instead of leaking a raw DuckDB name.

Run: python3 -m pytest tests/profile_types_test.py -q
"""

import importlib.util
import sys
from pathlib import Path

import pytest

_SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "skill"
    / "featherbi"
    / "scripts"
    / "profile.py"
)
_spec = importlib.util.spec_from_file_location("profile", _SCRIPT)
assert _spec is not None and _spec.loader is not None, f"cannot load {_SCRIPT}"
sys.path.insert(0, str(_SCRIPT.parent))
profile = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(profile)


def test_supported_duckdb_types_map_to_schema_types():
    cases = {
        "VARCHAR": "string",
        "BOOLEAN": "boolean",
        "TINYINT": "integer",
        "INTEGER": "integer",
        "BIGINT": "integer",
        "HUGEINT": "integer",
        "UTINYINT": "integer",
        "UBIGINT": "integer",
        "FLOAT": "number",
        "DOUBLE": "number",
        "DECIMAL(18,3)": "number",
        "DATE": "date",
        "TIMESTAMP": "timestamp",
        "TIMESTAMP WITH TIME ZONE": "timestamp",
    }
    for duckdb_name, expected in cases.items():
        assert profile.featherbi_type("col", duckdb_name) == expected, duckdb_name


def test_unknown_duckdb_type_fails_with_column_name_and_remedy():
    with pytest.raises(ValueError) as error:
        profile.featherbi_type("inspection_time", "TIME")
    message = str(error.value)
    assert "inspection_time" in message
    assert "TIME" in message
    assert "cast" in message
    for supported in ("string", "boolean", "integer", "number", "date", "timestamp"):
        assert supported in message

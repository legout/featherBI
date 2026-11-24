"""Regenerates the Iceberg and Delta fixtures (the rest: make.sql). Needs deltalake, pyiceberg, pyarrow.
Run inside fixtures/formats: python make.py"""
import pathlib, shutil
import pyarrow as pa
from deltalake import write_deltalake
from pyiceberg.catalog.sql import SqlCatalog

t = pa.table({"id": [1, 2, 3, 4, 5], "name": ["a", "b", "c", "d", "e"], "amount": [10.5, 20.0, 30.25, 40.0, 50.0]})
here = pathlib.Path(".").resolve()
shutil.rmtree("delta", ignore_errors=True)
write_deltalake("delta", t)
shutil.rmtree("iceberg", ignore_errors=True)
pathlib.Path("iceberg").mkdir()
cat = SqlCatalog("c", uri="sqlite:////tmp/ice-cat.db", warehouse=f"file://{here}/iceberg")
cat.create_namespace_if_not_exists("ns")
cat.create_table("ns.items", t.schema).append(t)
# DuckDB's iceberg_scan finds the current metadata through a version hint.
meta = pathlib.Path("iceberg/ns/items/metadata")
latest = sorted(meta.glob("*.metadata.json"))[-1]
(meta / "version-hint.text").write_text(latest.name.removesuffix(".metadata.json"))

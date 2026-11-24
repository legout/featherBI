-- Regenerates the CSV, JSON, Parquet, XLSX, SQLite and DuckLake fixtures (Delta, Iceberg: make.py).
-- Run inside fixtures/formats: duckdb < make.sql
INSTALL excel; LOAD excel; INSTALL sqlite_scanner; LOAD sqlite_scanner; INSTALL ducklake; LOAD ducklake;
CREATE TEMP TABLE items AS SELECT * FROM (VALUES (1,'a',10.5),(2,'b',20.0),(3,'c',30.25),(4,'d',40.0),(5,'e',50.0)) t(id,name,amount);
COPY items TO 'items.csv' (FORMAT csv, HEADER true);
COPY items TO 'items.json' (FORMAT json, ARRAY true);
COPY items TO 'items.parquet' (FORMAT parquet);
COPY items TO 'items.xlsx' (FORMAT xlsx, HEADER true);
ATTACH 'items.sqlite' AS s (TYPE sqlite);
CREATE TABLE s.items AS SELECT * FROM items;
DETACH s;
ATTACH 'ducklake:items.ducklake' AS d (DATA_PATH 'items.ducklake.files/');
CREATE TABLE d.items AS SELECT * FROM items;

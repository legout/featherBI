// P1.3 — reproducible parity, join, and boundary fixtures
// (runtime contract v1 §4 normalization targets; RC-02/RC-03 shapes).
//
// These tests verify (a) the committed canonical fixtures under
// tests/fixtures/ and (b) the artifacts produced by `npm run fixtures`
// (uv + pinned duckdb 1.5.5). Expected values come from
// tests/fixtures/expected.json, which is authored independently of the
// generator: nothing here derives expected values from code under test, and
// the metric recomputations below mirror the AP reference SQL semantics
// (docs/specs/ap-inspection-dashboard.md) rather than the generator's logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateConfig } from "../../contract/config.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const fixturesDir = path.join(rootDir, "tests/fixtures");
const artifactsDir = path.join(rootDir, ".artifacts/fixtures");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function artifactPath(name) {
  return path.join(artifactsDir, name);
}

function requireArtifact(name) {
  const file = artifactPath(name);
  assert.ok(
    existsSync(file),
    `generated fixture ${name} must exist after \`npm run fixtures\``,
  );
  return file;
}

async function readArtifact(name) {
  return readFile(requireArtifact(name), "utf8");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const expected = await readJson(path.join(fixturesDir, "expected.json"));
const canonicalRows = await readJson(path.join(fixturesDir, "rows.json"));
const canonicalProducts = await readJson(
  path.join(fixturesDir, "products.json"),
);
const runtimeConfig = await readJson(
  path.join(fixturesDir, "runtime.config.json"),
);
const COLUMNS = Object.entries(expected.canonical.columns);

// --- Independent AP-semantics reference implementation (test-side only) ---

function dayOf(timestamp) {
  return timestamp.slice(0, 10);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function defaultWindowBounds(rows) {
  const max = rows
    .map((row) => row.inspection_date)
    .sort()
    .at(-1);
  const through = dayOf(max);
  return {
    from: addDays(through, -29),
    through,
    toExclusive: addDays(through, 1),
  };
}

function rowsInWindow(rows, bounds) {
  return rows.filter((row) => {
    const day = dayOf(row.inspection_date);
    return day >= bounds.from && day < bounds.toExclusive;
  });
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function distinctCount(rows, key) {
  return new Set(rows.map((row) => row[key]).filter((value) => value !== null))
    .size;
}

function pct(part, total) {
  return Math.round(((100 * part) / total) * 100) / 100;
}

function metricsOf(rows) {
  const codePresent = rows.filter((row) => row.G0003 !== null).length;
  const nonLast = rows.filter(
    (row) => row.is_last_measurement === false,
  ).length;
  return {
    records: rows.length,
    distinctOrders: distinctCount(rows, "order_number"),
    distinctProducts: distinctCount(rows, "product_mlfb"),
    activeStations: distinctCount(rows, "test_station_identifier"),
    g0003Present: codePresent,
    g0003PresentPct: pct(codePresent, rows.length),
    notLastMeasurement: nonLast,
    notLastMeasurementPct: pct(nonLast, rows.length),
  };
}

function joinStats(rows, products) {
  const labels = new Map(
    products.map((product) => [product.product_mlfb, product.product_label]),
  );
  const matchedKeys = new Set();
  let matched = 0;
  let unmatched = 0;
  for (const row of rows) {
    if (row.product_mlfb !== null && labels.has(row.product_mlfb)) {
      matched += 1;
      matchedKeys.add(row.product_mlfb);
    } else {
      unmatched += 1;
    }
  }
  const labelsSeen = {};
  for (const key of matchedKeys) {
    labelsSeen[key] = labels.get(key);
  }
  return {
    matchedInspectionRows: matched,
    unmatchedInspectionRows: unmatched,
    unmatchedProductRows: products.filter(
      (product) => !matchedKeys.has(product.product_mlfb),
    ).length,
    labels: labelsSeen,
  };
}

// --- RFC 4180 parser preserving the quoted/unquoted field distinction ---

function parseCsvRecords(text) {
  const records = [];
  let record = [];
  let field = "";
  let fieldQuoted = false;
  let inQuotes = false;
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (inQuotes) {
      if (ch === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += ch;
      index += 1;
      continue;
    }
    if (ch === '"' && field === "" && !fieldQuoted) {
      inQuotes = true;
      fieldQuoted = true;
      index += 1;
      continue;
    }
    if (ch === ",") {
      record.push({ value: field, quoted: fieldQuoted });
      field = "";
      fieldQuoted = false;
      index += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      record.push({ value: field, quoted: fieldQuoted });
      records.push(record);
      record = [];
      field = "";
      fieldQuoted = false;
      index += 1;
      continue;
    }
    field += ch;
    index += 1;
  }
  if (field !== "" || fieldQuoted || record.length > 0) {
    record.push({ value: field, quoted: fieldQuoted });
    records.push(record);
  }
  return records;
}

function normalizeCsvField(parsed, type) {
  if (!parsed.quoted && parsed.value === "") {
    return null;
  }
  if (type === "boolean") {
    return parsed.value === "true"
      ? true
      : parsed.value === "false"
        ? false
        : parsed.value;
  }
  if (type === "timestamp") {
    return parsed.value.replace(" ", "T");
  }
  return parsed.value;
}

function csvRowsToObjects(records) {
  const header = records[0].map((field) => field.value);
  return records.slice(1).map((record) => {
    const row = {};
    for (const [index, name] of header.entries()) {
      const type = Object.fromEntries(COLUMNS)[name] ?? "string";
      row[name] = normalizeCsvField(record[index], type);
    }
    return row;
  });
}

function normalizeJsonRow(row) {
  const out = {};
  for (const [name, type] of COLUMNS) {
    const value = row[name];
    out[name] =
      type === "timestamp" && typeof value === "string"
        ? value.replace(" ", "T")
        : value;
  }
  return out;
}

// --- 1. Committed canonical rows carry the designed boundaries ---

test("rows.json holds five AP-shaped canonical records with the designed boundaries", () => {
  assert.equal(canonicalRows.length, expected.canonical.rowCount);
  const names = COLUMNS.map(([name]) => name);
  for (const [index, row] of canonicalRows.entries()) {
    assert.deepEqual(
      Object.keys(row),
      names,
      `row ${index} must have exactly the canonical columns in order`,
    );
  }
  const lexical = expected.parity.csvLexical;
  assert.equal(canonicalRows[0].sequence_number, lexical.leadingZeroIdentifier);
  assert.equal(
    canonicalRows[lexical.quotedEmptyStringRowIndex].sequence_number,
    "",
    "quoted empty string must be a present empty string, not null",
  );
  assert.equal(
    canonicalRows[lexical.unquotedNullRowIndex].sequence_number,
    null,
    "the null sequence number must be JSON null",
  );
  const boundaries = expected.boundaries;
  assert.equal(
    canonicalRows[boundaries.missingProductRowIndex].product_mlfb,
    null,
    "missing product must be null",
  );
  assert.equal(
    canonicalRows[boundaries.nullableBooleanNullRowIndex].is_last_measurement,
    null,
    "nullable boolean null must stay null, not false",
  );
  assert.equal(
    canonicalRows[boundaries.rowOutsideWindow.index].inspection_date,
    boundaries.rowOutsideWindow.inspectionDate,
  );
  assert.equal(
    canonicalRows[boundaries.firstInstantInside.index].inspection_date,
    boundaries.firstInstantInside.inspectionDate,
  );
  assert.equal(
    canonicalRows[boundaries.lastInstantInside.index].inspection_date,
    boundaries.lastInstantInside.inspectionDate,
  );
  const bounds = defaultWindowBounds(canonicalRows);
  assert.deepEqual(
    canonicalRows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => rowsInWindow([row], bounds).length > 0)
      .map(({ index }) => index),
    expected.defaultWindow.anchor.rowIndicesInside,
  );
  assert.equal(canonicalProducts.length, expected.canonical.productRowCount);
});

// --- 2/3. expected.json aggregates agree with independent recomputation ---

test("expected.json default-window metrics match an independent AP-semantics recomputation", () => {
  const bounds = defaultWindowBounds(canonicalRows);
  assert.equal(bounds.from, expected.defaultWindow.anchor.from);
  assert.equal(bounds.through, expected.defaultWindow.anchor.through);
  assert.equal(bounds.toExclusive, expected.defaultWindow.anchor.toExclusive);
  const windowRows = rowsInWindow(canonicalRows, bounds);
  assert.deepEqual(
    metricsOf(windowRows),
    expected.defaultWindow.metrics,
    "AP reference-SQL semantics over the default window",
  );
  assert.deepEqual(
    countBy(windowRows, (row) => row.source),
    expected.defaultWindow.bySource,
  );
  assert.deepEqual(
    countBy(windowRows, (row) => row.test_station_identifier),
    expected.defaultWindow.byStation,
  );
  assert.deepEqual(
    countBy(windowRows, (row) => dayOf(row.inspection_date)),
    expected.defaultWindow.byDay,
  );
  const byDayBySource = {};
  for (const row of windowRows) {
    const day = dayOf(row.inspection_date);
    byDayBySource[day] ??= {};
    byDayBySource[day][row.source] = (byDayBySource[day][row.source] ?? 0) + 1;
  }
  assert.deepEqual(byDayBySource, expected.defaultWindow.byDayBySource);
  assert.deepEqual(
    countBy(
      windowRows.filter((row) => row.G0003 !== null),
      (row) => row.G0003,
    ),
    expected.defaultWindow.g0003Frequency,
  );
});

test("expected.json all-rows metrics and join totals match an independent recomputation", () => {
  assert.deepEqual(metricsOf(canonicalRows), expected.allRows.metrics);
  assert.deepEqual(
    countBy(canonicalRows, (row) => row.source),
    expected.allRows.bySource,
  );
  assert.deepEqual(
    joinStats(canonicalRows, canonicalProducts),
    expected.join.allRows,
    "join totals over all rows",
  );
  const bounds = defaultWindowBounds(canonicalRows);
  const windowJoin = joinStats(
    rowsInWindow(canonicalRows, bounds),
    canonicalProducts,
  );
  assert.deepEqual(windowJoin, expected.join.defaultWindow);
});

// --- 4. runtime.config.json is accepted by the shared validator ---

test("runtime.config.json is accepted by the shared validator with the expected sources", () => {
  const result = validateConfig(runtimeConfig);
  assert.ok(
    result.ok,
    `runtime.config.json must validate: ${JSON.stringify(result.issues ?? [])}`,
  );
  assert.deepEqual(
    runtimeConfig.data.sources.map((source) => source.id),
    expected.configExpectations.sourceIds,
  );
  const inspections = runtimeConfig.data.sources.find(
    (source) => source.id === "inspections",
  );
  assert.equal(inspections.type, expected.configExpectations.inspectionsType);
  assert.equal(inspections.file, expected.configExpectations.inspectionsFile);
  assert.deepEqual(
    Object.keys(inspections.schema),
    COLUMNS.map(([name]) => name),
  );
  for (const [name, type] of COLUMNS) {
    assert.equal(
      inspections.schema[name].type,
      type,
      `declared type for ${name}`,
    );
  }
  assert.equal(
    inspections.schema.sequence_number.nullable,
    true,
    "sequence_number must be nullable (null vs empty string)",
  );
  assert.equal(
    inspections.schema.is_last_measurement.nullable,
    true,
    "is_last_measurement must be nullable",
  );
});

// --- 5. Required generated artifacts exist ---

test("required generated artifacts exist after npm run fixtures", () => {
  for (const format of expected.parity.formats) {
    requireArtifact(`inspections.${format}`);
  }
  requireArtifact(expected.configExpectations.productsFile);
  requireArtifact(expected.artifacts.manifest);
});

// --- 6/7/8. Parity: every textual format yields the canonical rows ---

test("generated inspections.csv parses back to the canonical rows", async () => {
  const records = parseCsvRecords(await readArtifact("inspections.csv"));
  assert.equal(records.length, canonicalRows.length + 1, "header + 5 rows");
  assert.deepEqual(
    records[0].map((field) => field.value),
    COLUMNS.map(([name]) => name),
    "header must list the canonical columns in order",
  );
  const lexical = expected.parity.csvLexical;
  const quotedEmptyRow = records[lexical.quotedEmptyStringRowIndex + 1];
  const quotedField =
    quotedEmptyRow[
      COLUMNS.findIndex(([name]) => name === lexical.quotedEmptyStringColumn)
    ];
  assert.ok(
    quotedField.quoted,
    "the empty string must be written as a quoted field",
  );
  assert.equal(quotedField.value, "");
  const nullRow = records[lexical.unquotedNullRowIndex + 1];
  const nullField =
    nullRow[COLUMNS.findIndex(([name]) => name === lexical.unquotedNullColumn)];
  assert.equal(
    nullField.quoted,
    false,
    "null must be written as an unquoted empty field",
  );
  assert.equal(nullField.value, "");
  const parsedRows = csvRowsToObjects(records);
  assert.deepEqual(parsedRows, canonicalRows);
});

test("generated inspections.json parses back to the canonical rows", async () => {
  const parsed = JSON.parse(await readArtifact("inspections.json"));
  assert.ok(Array.isArray(parsed), "array form");
  assert.deepEqual(parsed.map(normalizeJsonRow), canonicalRows);
});

test("generated inspections.ndjson parses back to the canonical rows", async () => {
  const lines = (await readArtifact("inspections.ndjson"))
    .split("\n")
    .filter((line) => line.trim() !== "");
  assert.equal(lines.length, canonicalRows.length);
  assert.deepEqual(
    lines.map((line) => normalizeJsonRow(JSON.parse(line))),
    canonicalRows,
  );
});

// --- 9. Parquet containers ---

test("generated Parquet files are PAR1 containers with the expected row counts", async () => {
  const manifest = await readJson(artifactPath(expected.artifacts.manifest));
  for (const name of ["inspections.parquet", "products.parquet"]) {
    const buffer = await readFile(requireArtifact(name));
    assert.ok(buffer.length > 8, `${name} must not be empty`);
    assert.equal(
      buffer.subarray(0, 4).toString("latin1"),
      "PAR1",
      `${name} must start with the Parquet magic bytes`,
    );
    assert.equal(
      buffer.subarray(buffer.length - 4).toString("latin1"),
      "PAR1",
      `${name} must end with the Parquet magic bytes`,
    );
  }
  const entry = (name) => manifest.files.find((file) => file.name === name);
  assert.equal(entry("inspections.parquet").rows, expected.parity.rows);
  assert.equal(
    entry("products.parquet").rows,
    expected.canonical.productRowCount,
  );
  assert.equal(
    manifest.parityVerified["inspections.parquet"],
    true,
    "generator must verify Parquet content against the canonical rows",
  );
});

// --- 10/11. Manifest agreement ---

test("manifest digests, row counts, and expected outcomes agree with the files and expected.json", async () => {
  const manifest = await readJson(artifactPath(expected.artifacts.manifest));
  const byName = new Map(manifest.files.map((file) => [file.name, file]));
  assert.equal(
    manifest.files.length,
    expected.parity.formats.length +
      1 +
      expected.negative.length +
      expected.boundaryFixtures.length,
    "4 inspections formats + products.parquet + negative + boundary fixtures",
  );
  for (const file of manifest.files) {
    const buffer = await readFile(requireArtifact(file.name));
    assert.equal(
      file.sha256,
      sha256(buffer),
      `manifest digest for ${file.name} must match the file on disk`,
    );
    assert.equal(file.bytes, buffer.length);
    const lines = buffer
      .toString("utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    if (file.kind === "parity") {
      assert.equal(file.rows, file.name === "products.parquet" ? 3 : 5);
    }
    if (file.name.endsWith(".csv")) {
      assert.equal(file.rows, lines.length - 1, `data rows for ${file.name}`);
    }
  }
  for (const negative of expected.negative) {
    const entry = byName.get(negative.file);
    assert.ok(entry, `manifest must list ${negative.file}`);
    assert.equal(entry.kind, "negative");
    assert.equal(entry.rows, negative.dataRows);
    assert.equal(entry.expectedOutcome, negative.outcome);
    assert.equal(entry.reason, negative.reason);
    assert.deepEqual(entry.offending, negative.offending);
  }
  for (const boundary of expected.boundaryFixtures) {
    const entry = byName.get(boundary.file);
    assert.ok(entry, `manifest must list ${boundary.file}`);
    assert.equal(entry.kind, "boundary");
    assert.equal(entry.rows, boundary.dataRows);
    assert.equal(entry.expectedOutcome, boundary.outcome);
  }
});

test("manifest records the pinned generator identity", async () => {
  const manifest = await readJson(artifactPath(expected.artifacts.manifest));
  assert.equal(manifest.generator.duckdbPin, "1.5.5");
  assert.equal(manifest.generator.duckdbVersion, "1.5.5");
  assert.equal(manifest.generator.command, "uv run tests/fixtures/generate.py");
  assert.deepEqual(
    Object.keys(manifest.generator.sources),
    expected.configExpectations.sourceIds,
  );
  assert.equal(
    manifest.generator.sources.inspections.file,
    expected.configExpectations.inspectionsFile,
  );
});

// --- 12. Negative fixtures carry their designed defects ---

test("negative fixtures carry their designed defects", async () => {
  const lines = async (name) =>
    (await readArtifact(name)).split("\n").filter((line) => line !== "");
  const invalidDate = await lines("neg-invalid-date.csv");
  assert.equal(invalidDate.length, 4);
  assert.equal(invalidDate[1], "2026-01-15,ok");
  assert.ok(invalidDate.includes("2026-02-30,leap-day-invalid"));

  const offset = await lines("neg-timestamp-offset.csv");
  assert.equal(offset[1], "2026-01-01T10:00:00,naive-ok");
  assert.ok(offset.includes("2026-01-02T10:00:00+02:00,offset-bearing"));

  const unsafe = await lines("neg-unsafe-integer.csv");
  assert.equal(unsafe.length, 4);
  assert.equal(unsafe[2], "9007199254740991,max-safe-integer-ok");
  assert.equal(unsafe[3], "9007199254740993,unsafe-integer");

  const malformed = await lines("neg-malformed-final-row.csv");
  assert.equal(malformed.length, 503);
  for (const line of malformed.slice(1, -1)) {
    const flag = line.split(",")[2];
    assert.ok(
      flag === "true" || flag === "false",
      `every sampled row before the final row must hold a valid boolean, found ${flag}`,
    );
  }
  assert.equal(
    malformed[502].split(",")[2],
    "MAYBE",
    "the malformed boolean must sit on the final row, beyond any initial sample",
  );

  const duplicate = await readArtifact("neg-duplicate-headers.csv");
  assert.equal(duplicate.split("\n")[0], "station,station,records");
  const colliding = await readArtifact("neg-case-colliding-headers.csv");
  assert.equal(colliding.split("\n")[0], "Station,station");

  const nested = JSON.parse(await readArtifact("neg-nested-json.json"));
  assert.equal(nested[0].payload, "ok");
  assert.deepEqual(nested[1].payload, { nested: true });
  assert.deepEqual(nested[2].payload, ["a", "b"]);

  const missingColumn = await readArtifact("neg-missing-column.csv");
  assert.equal(
    missingColumn.split("\n")[0],
    "station",
    "the order_number column must be absent from the header entirely",
  );

  const missingKey = (await readArtifact("neg-missing-key.ndjson"))
    .split("\n")
    .filter((line) => line !== "");
  assert.equal(missingKey.length, 3);
  assert.ok(Object.hasOwn(JSON.parse(missingKey[0]), "order_number"));
  assert.ok(Object.hasOwn(JSON.parse(missingKey[1]), "order_number"));
  assert.equal(
    Object.hasOwn(JSON.parse(missingKey[2]), "order_number"),
    false,
    "the final record must lack the required key",
  );
});

// --- 13. Boundary/valid fixtures hold their designed values ---

test("boundary and valid-empty fixtures hold their designed values", async () => {
  const micro = await readArtifact("ok-timestamp-microseconds.csv");
  assert.deepEqual(
    micro.split("\n").filter((l) => l !== ""),
    ["recorded_at", "2026-01-01T12:34:56.123456"],
  );

  const safe = (await readArtifact("ok-safe-integers.csv"))
    .split("\n")
    .filter((line) => line !== "");
  assert.deepEqual(safe, ["value", "-9007199254740991", "9007199254740991"]);

  const emptyCsv = await readArtifact("ok-empty.csv");
  assert.deepEqual(
    emptyCsv.split("\n").filter((line) => line !== ""),
    ["order_number,station,is_last_measurement"],
    "a header-only CSV is a valid empty dataset",
  );
  assert.equal(await readArtifact("ok-empty.json"), "[]");

  const emptyParquet = await readFile(requireArtifact("ok-empty.parquet"));
  assert.equal(
    emptyParquet.subarray(0, 4).toString("latin1"),
    "PAR1",
    "an empty Parquet must still be a valid container with its schema",
  );
  const manifest = await readJson(artifactPath(expected.artifacts.manifest));
  const emptyEntry = manifest.files.find(
    (file) => file.name === "ok-empty.parquet",
  );
  assert.equal(emptyEntry.rows, 0);
});

// --- 14/15. Deterministic scale fixtures ---

test("chart fixture is the deterministic 10001-row overrun case", async () => {
  const chart = expected.boundaryFixtures.find(
    (fixture) => fixture.file === "chart-10001.csv",
  );
  const lines = (await readArtifact("chart-10001.csv"))
    .split("\n")
    .filter((line) => line !== "");
  assert.equal(lines[0], "day,records");
  const dataLines = lines.slice(1);
  assert.equal(dataLines.length, chart.dataRows);
  let loopSum = 0;
  for (const [index, line] of dataLines.entries()) {
    const [day, records] = line.split(",");
    assert.equal(day, addDays(chart.firstDay, index));
    assert.equal(records, String(index));
    loopSum += Number(records);
  }
  assert.equal(loopSum, chart.sum);
  assert.equal(loopSum, (chart.lastValue * (chart.lastValue + 1)) / 2);
  assert.equal(dataLines[0], `${chart.firstDay},${chart.firstValue}`);
  assert.equal(
    dataLines[dataLines.length - 1],
    `${chart.lastDay},${chart.lastValue}`,
  );
});

test("table fixture is the deterministic 205-row uniquely ordered case", async () => {
  const table = expected.boundaryFixtures.find(
    (fixture) => fixture.file === "table-205.csv",
  );
  const lines = (await readArtifact("table-205.csv"))
    .split("\n")
    .filter((line) => line !== "");
  assert.equal(lines[0], "rank,order_number,station,takt_seconds,flag");
  const dataLines = lines.slice(1);
  assert.equal(dataLines.length, table.dataRows);
  const orderNumbers = new Set();
  let previousRank = 0;
  for (const [index, line] of dataLines.entries()) {
    const [rankText, orderNumber, station, takt, flag] = line.split(",");
    const rank = index + 1;
    assert.equal(rankText, String(rank));
    assert.ok(rank > previousRank, "rank must strictly increase");
    previousRank = rank;
    assert.equal(orderNumber, `R${String(rank).padStart(7, "0")}`);
    orderNumbers.add(orderNumber);
    assert.equal(station, table.stationCycle[rank % 3]);
    assert.equal(takt, (60 + rank * 0.5).toFixed(1));
    assert.equal(flag, rank % 2 === 1 ? "true" : "false");
  }
  assert.equal(orderNumbers.size, table.dataRows, "order numbers are unique");
  assert.equal(dataLines[0].split(",")[3], table.taktFirst.toFixed(1));
  assert.equal(
    dataLines[dataLines.length - 1].split(",")[3],
    table.taktLast.toFixed(1),
  );
});

// --- 16. Privacy guard ---

test("no committed or generated fixture references private AP data", async () => {
  const forbidden = expected.privacy.forbiddenReferences;
  // expected.json is excluded here: it declares the forbidden markers as the
  // guard's own configuration and carries no row data.
  const committed = ["rows.json", "products.json", "runtime.config.json"];
  for (const name of committed) {
    const text = await readFile(path.join(fixturesDir, name), "utf8");
    for (const marker of forbidden) {
      assert.ok(
        !text.includes(marker),
        `${name} must not reference private AP data (${marker})`,
      );
    }
  }
  const manifest = await readJson(artifactPath(expected.artifacts.manifest));
  for (const file of manifest.files) {
    const text = await readFile(requireArtifact(file.name), "utf8");
    for (const marker of forbidden) {
      assert.ok(
        !text.includes(marker),
        `${file.name} must not reference private AP data (${marker})`,
      );
    }
  }
});

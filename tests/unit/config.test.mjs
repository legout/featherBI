// P1.1 — structural config validation tests (runtime contract v1, sections 3, 6, 7).
// These tests target the public seam contract/config.mjs#validateConfig.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateConfig } from "../../contract/config.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// A config that is valid both structurally and semantically; negative cases mutate it.
const BASE_CONFIG = {
  contract: 1,
  app: "grid",
  title: "Inspection activity",
  data: {
    mode: "upload",
    sources: [
      {
        id: "inspections",
        type: "parquet",
        file: "inspections.parquet",
        schema: {
          station: { type: "string", nullable: false },
          inspection_date: { type: "timestamp", nullable: false },
          order_number: { type: "string", nullable: false },
          product_mlfb: { type: "string", nullable: true },
          g0003: { type: "string", nullable: true },
          is_last_measurement: { type: "boolean", nullable: true },
          dut_seq: { type: "integer", nullable: true },
          failure_ratio: { type: "number", nullable: true },
          inspection_day: { type: "date", nullable: true },
        },
      },
    ],
  },
  filters: [
    {
      id: "station",
      kind: "select",
      source: "inspections",
      column: "station",
      default: null,
    },
    {
      id: "order_number",
      kind: "text",
      source: "inspections",
      column: "order_number",
      default: null,
    },
    {
      id: "window",
      kind: "date-range",
      source: "inspections",
      column: "inspection_date",
      default: { kind: "latest-days", days: 30 },
    },
  ],
  queries: {
    summary: {
      sql: "SELECT count(*) AS records FROM inspections WHERE ($station IS NULL OR station = $station) AND inspection_date >= $window_from AND inspection_date < $window_to",
      params: ["station", "window_from", "window_to"],
    },
    timeline: {
      sql: "SELECT station, count(*) AS records FROM inspections GROUP BY station ORDER BY records DESC",
      params: [],
    },
    records: {
      sql: "SELECT inspection_date, order_number FROM inspections ORDER BY inspection_date",
      params: [],
    },
  },
  layout: [
    {
      id: "records",
      type: "kpi",
      query: "summary",
      field: "records",
      label: "Inspection records",
      decimals: 0,
    },
    {
      id: "by_station",
      type: "bar",
      query: "timeline",
      x: "station",
      y: "records",
      label: "Records by station",
      orientation: "vertical",
      annotations: [{ at: "2023-11-23", label: "source transition" }],
    },
    {
      id: "orders_over_time",
      type: "line",
      query: "timeline",
      x: "station",
      y: "records",
      series: "station",
      label: "Records over time",
    },
    {
      id: "station_days",
      type: "heatmap",
      query: "timeline",
      x: "station",
      y: "records",
      value: "records",
      label: "Station x day",
    },
    {
      id: "record_table",
      type: "table",
      query: "records",
      label: "Filtered records",
      columns: [
        { field: "inspection_date", label: "Timestamp" },
        { field: "order_number", label: "Order" },
      ],
    },
  ],
};

function baseConfig() {
  return structuredClone(BASE_CONFIG);
}

function accepted(config) {
  const snapshot = structuredClone(config);
  const result = validateConfig(config);
  assert.ok(result.ok, `expected acceptance, got ${JSON.stringify(result)}`);
  assert.equal(
    "issues" in result,
    false,
    `accepted result must not carry issues: ${JSON.stringify(result)}`,
  );
  assert.deepEqual(
    result.value,
    snapshot,
    "value must equal the validated config",
  );
  assert.deepEqual(config, snapshot, "input must not be mutated by validation");
  return result;
}

function rejectedWith(config, code, issuePath) {
  const result = validateConfig(config);
  assert.equal(
    result.ok,
    false,
    `expected rejection, got ${JSON.stringify(result)}`,
  );
  const found = (result.issues ?? []).find(
    (issue) => issue.code === code && issue.path === issuePath,
  );
  assert.ok(
    found,
    `expected issue ${code} at ${JSON.stringify(issuePath)}, got ${JSON.stringify(result.issues)}`,
  );
  for (const issue of result.issues) {
    assert.equal(
      typeof issue.path,
      "string",
      `issue path must be a string: ${JSON.stringify(issue)}`,
    );
    assert.equal(
      typeof issue.code,
      "string",
      `issue code must be a string: ${JSON.stringify(issue)}`,
    );
    assert.ok(
      issue.message.length > 0,
      `issue message must be non-empty: ${JSON.stringify(issue)}`,
    );
  }
  return result;
}

test("accepts the specification minimal example", async () => {
  const minimal = JSON.parse(
    await readFile(
      path.join(rootDir, "tests", "fixtures", "minimal.config.json"),
      "utf8",
    ),
  );
  accepted(minimal);
});

test("accepts upload mode with every filter kind and component kind", () => {
  accepted(baseConfig());
});

test("accepts embedded mode with base64 content", () => {
  const config = baseConfig();
  config.data.mode = "embedded";
  config.data.sources[0].content = {
    encoding: "base64",
    value: "UEsDBBQAAgAAMDE=",
  };
  accepted(config);
});

test("accepts select defaults for every declared column type", () => {
  const config = baseConfig();
  config.filters = [
    {
      id: "f_str",
      kind: "select",
      source: "inspections",
      column: "station",
      default: "SJ",
    },
    {
      id: "f_bool",
      kind: "select",
      source: "inspections",
      column: "is_last_measurement",
      default: true,
    },
    {
      id: "f_int",
      kind: "select",
      source: "inspections",
      column: "dut_seq",
      default: 42,
    },
    {
      id: "f_num",
      kind: "select",
      source: "inspections",
      column: "failure_ratio",
      default: 0.5,
    },
    {
      id: "f_date",
      kind: "select",
      source: "inspections",
      column: "inspection_day",
      default: "2026-08-26",
    },
    {
      id: "f_ts",
      kind: "select",
      source: "inspections",
      column: "inspection_date",
      default: "2026-08-26T12:26:34.123456",
    },
  ];
  config.queries.summary.params = ["f_str"];
  accepted(config);
});

test("rejects unsupported contract versions", () => {
  const config = baseConfig();
  config.contract = 2;
  rejectedWith(config, "schema.const", "contract");
});

test("rejects unsupported app kinds", () => {
  const config = baseConfig();
  config.app = "table";
  rejectedWith(config, "schema.const", "app");
});

test("rejects missing required top-level keys", () => {
  const config = baseConfig();
  delete config.title;
  rejectedWith(config, "schema.required", "");
});

test("rejects unknown top-level properties", () => {
  const config = baseConfig();
  config.theme = "dark";
  rejectedWith(config, "schema.additionalProperties", "");
});

test("rejects unknown nested source properties", () => {
  const config = baseConfig();
  config.data.sources[0].path = "/tmp/inspections.parquet";
  rejectedWith(config, "schema.additionalProperties", "data.sources[0]");
});

test("rejects unknown nested schema-column properties", () => {
  const config = baseConfig();
  config.data.sources[0].schema.station.description = "plant name";
  rejectedWith(
    config,
    "schema.additionalProperties",
    "data.sources[0].schema.station",
  );
});

test("rejects schema columns missing nullable", () => {
  const config = baseConfig();
  delete config.data.sources[0].schema.station.nullable;
  rejectedWith(config, "schema.required", "data.sources[0].schema.station");
});

test("rejects unsupported column types", () => {
  const config = baseConfig();
  config.data.sources[0].schema.station.type = "float";
  rejectedWith(config, "schema.enum", "data.sources[0].schema.station.type");
});

test("rejects empty column names", () => {
  const config = baseConfig();
  config.data.sources[0].schema[""] = { type: "string", nullable: true };
  rejectedWith(config, "column.empty-name", "data.sources[0].schema");
});

test("rejects empty source schemas", () => {
  const config = baseConfig();
  config.data.sources[0].schema = {};
  rejectedWith(config, "schema.minProperties", "data.sources[0].schema");
});

test("rejects unsupported delivery modes", () => {
  const config = baseConfig();
  config.data.mode = "inline";
  rejectedWith(config, "schema.enum", "data.mode");
});

test("rejects empty source lists", () => {
  const config = baseConfig();
  config.data.sources = [];
  rejectedWith(config, "schema.minItems", "data.sources");
});

test("rejects invalid source ids", () => {
  const config = baseConfig();
  config.data.sources[0].id = "Inspections";
  rejectedWith(config, "schema.pattern", "data.sources[0].id");
});

test("rejects unsafe file basenames containing a slash", () => {
  const config = baseConfig();
  config.data.sources[0].file = "data/inspections.parquet";
  rejectedWith(config, "schema.pattern", "data.sources[0].file");
});

test("rejects unsafe file basenames containing a backslash", () => {
  const config = baseConfig();
  config.data.sources[0].file = "data\\inspections.parquet";
  rejectedWith(config, "schema.pattern", "data.sources[0].file");
});

test("rejects unsafe file basenames containing a colon", () => {
  const config = baseConfig();
  config.data.sources[0].file = "inspections:v1.parquet";
  rejectedWith(config, "schema.pattern", "data.sources[0].file");
});

test("rejects empty file basenames", () => {
  const config = baseConfig();
  config.data.sources[0].file = "";
  rejectedWith(config, "schema.pattern", "data.sources[0].file");
});

test("rejects reserved dot file basenames", () => {
  const config = baseConfig();
  config.data.sources[0].file = ".";
  rejectedWith(config, "file.reserved", "data.sources[0].file");
  const config2 = baseConfig();
  config2.data.sources[0].file = "..";
  rejectedWith(config2, "file.reserved", "data.sources[0].file");
});

test("rejects content on upload sources", () => {
  const config = baseConfig();
  config.data.sources[0].content = {
    encoding: "base64",
    value: "UEsDBBQAAgAAMDE=",
  };
  rejectedWith(config, "source.content-not-allowed", "data.sources[0].content");
});

test("rejects embedded sources without content", () => {
  const config = baseConfig();
  config.data.mode = "embedded";
  rejectedWith(config, "source.content-required", "data.sources[0]");
});

test("rejects wrong embedded-content encodings", () => {
  const config = baseConfig();
  config.data.mode = "embedded";
  config.data.sources[0].content = { encoding: "hex", value: "00ff" };
  rejectedWith(config, "schema.const", "data.sources[0].content.encoding");
});

test("rejects non-string embedded-content values", () => {
  const config = baseConfig();
  config.data.mode = "embedded";
  config.data.sources[0].content = { encoding: "base64", value: 123 };
  rejectedWith(config, "schema.type", "data.sources[0].content.value");
});

test("rejects non-base64 embedded-content values", () => {
  const config = baseConfig();
  config.data.mode = "embedded";
  config.data.sources[0].content = { encoding: "base64", value: "not base64!" };
  rejectedWith(config, "schema.pattern", "data.sources[0].content.value");
});

test("rejects base64 values with invalid length or padding", () => {
  // Each of these fails atob (InvalidCharacterError): the final quantum must be
  // 4 alphabet characters, 3 + '=', or 2 + '=='. Expected classifications were
  // verified independently against atob before this regression was written.
  for (const value of ["A", "A=", "A==", "AAAA=", "AAAA=="]) {
    const config = baseConfig();
    config.data.mode = "embedded";
    config.data.sources[0].content = { encoding: "base64", value };
    rejectedWith(
      config,
      "schema.pattern",
      "data.sources[0].content.value",
      `value=${value}`,
    );
  }
});

test("accepts canonical padded base64 values", () => {
  for (const value of ["TQ==", "TWE=", "TWFu", "TWFuTWE="]) {
    const config = baseConfig();
    config.data.mode = "embedded";
    config.data.sources[0].content = { encoding: "base64", value };
    accepted(config);
  }
});

test("rejects unknown embedded-content properties", () => {
  const config = baseConfig();
  config.data.mode = "embedded";
  config.data.sources[0].content = {
    encoding: "base64",
    value: "UEs=",
    url: "https://example.test",
  };
  rejectedWith(
    config,
    "schema.additionalProperties",
    "data.sources[0].content",
  );
});

test("rejects unsupported filter kinds", () => {
  const config = baseConfig();
  config.filters[0].kind = "multiselect";
  rejectedWith(config, "schema.enum", "filters[0].kind");
});

test("rejects filters missing required keys", () => {
  const config = baseConfig();
  delete config.filters[0].default;
  rejectedWith(config, "schema.required", "filters[0]");
});

test("rejects empty query sql", () => {
  const config = baseConfig();
  config.queries.summary.sql = "";
  rejectedWith(config, "schema.minLength", "queries.summary.sql");
});

test("rejects queries missing params", () => {
  const config = baseConfig();
  delete config.queries.summary.params;
  rejectedWith(config, "schema.required", "queries.summary");
});

test("rejects non-string query params", () => {
  const config = baseConfig();
  config.queries.summary.params = [5];
  rejectedWith(config, "schema.type", "queries.summary.params[0]");
});

test("rejects invalid query ids", () => {
  const config = baseConfig();
  config.queries.SUMMARY = { sql: "SELECT 1 AS x", params: [] };
  rejectedWith(config, "schema.propertyNames", "queries");
});

test("rejects unsupported component types", () => {
  const config = baseConfig();
  config.layout[0].type = "scatter";
  rejectedWith(config, "schema.enum", "layout[0].type");
});

test("rejects components missing required keys", () => {
  const config = baseConfig();
  delete config.layout[0].label;
  rejectedWith(config, "schema.required", "layout[0]");
});

test("rejects kpi components without a field binding", () => {
  const config = baseConfig();
  delete config.layout[0].field;
  rejectedWith(config, "schema.required", "layout[0]");
});

test("rejects kpi decimals above six", () => {
  const config = baseConfig();
  config.layout[0].decimals = 7;
  rejectedWith(config, "schema.maximum", "layout[0].decimals");
});

test("rejects non-integer kpi decimals", () => {
  const config = baseConfig();
  config.layout[0].decimals = "2";
  rejectedWith(config, "schema.type", "layout[0].decimals");
});

test("rejects bar components missing y", () => {
  const config = baseConfig();
  delete config.layout[1].y;
  rejectedWith(config, "schema.required", "layout[1]");
});

test("rejects unknown bar properties", () => {
  const config = baseConfig();
  config.layout[1].stack = "total";
  rejectedWith(config, "schema.additionalProperties", "layout[1]");
});

test("rejects orientation on line components", () => {
  const config = baseConfig();
  config.layout[2].orientation = "vertical";
  rejectedWith(config, "schema.additionalProperties", "layout[2]");
});

test("rejects annotations on heatmap components", () => {
  const config = baseConfig();
  config.layout[3].annotations = [{ at: "2026-01-01", label: "x" }];
  rejectedWith(config, "schema.additionalProperties", "layout[3]");
});

test("rejects heatmap components missing value", () => {
  const config = baseConfig();
  delete config.layout[3].value;
  rejectedWith(config, "schema.required", "layout[3]");
});

test("rejects empty table column lists", () => {
  const config = baseConfig();
  config.layout[4].columns = [];
  rejectedWith(config, "schema.minItems", "layout[4].columns");
});

test("rejects table columns missing label", () => {
  const config = baseConfig();
  delete config.layout[4].columns[0].label;
  rejectedWith(config, "schema.required", "layout[4].columns[0]");
});

test("rejects malformed annotation dates", () => {
  const config = baseConfig();
  config.layout[1].annotations[0].at = "2026-1-1";
  rejectedWith(config, "schema.pattern", "layout[1].annotations[0].at");
});

test("rejects annotations missing label", () => {
  const config = baseConfig();
  delete config.layout[1].annotations[0].label;
  rejectedWith(config, "schema.required", "layout[1].annotations[0]");
});

test("rejects empty titles", () => {
  const config = baseConfig();
  config.title = "";
  rejectedWith(config, "schema.minLength", "title");
});

test("rejects titles containing control characters", () => {
  const config = baseConfig();
  config.title = "Inspection\nactivity";
  rejectedWith(config, "schema.pattern", "title");
});

test("rejects non-object configs", () => {
  for (const input of ["grid", 1, null, true, [1, 2]]) {
    const result = validateConfig(input);
    assert.equal(
      result.ok,
      false,
      `expected rejection for ${JSON.stringify(input)}`,
    );
    assert.ok(
      result.issues.some(
        (issue) => issue.code === "schema.type" && issue.path === "",
      ),
    );
  }
});

test("generated validator contains no runtime code compilation", async () => {
  const source = await readFile(
    path.join(rootDir, ".generated", "validate-config.mjs"),
    "utf8",
  );
  assert.match(source, /export/, "generated module must be an ES module");
  assert.doesNotMatch(source, /new\s+Function/);
  assert.doesNotMatch(source, /(^|[^.\w])eval\s*\(/);
});

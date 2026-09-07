// P1.2 — semantic reference and parameter-namespace validation tests
// (runtime contract v1, sections 3, 6 and 7). Schema shape alone cannot prove
// references or binding consistency; these tests exercise the semantic layer of
// contract/config.mjs#validateConfig behind the same public result envelope.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../../contract/config.mjs";

// Mirrors the helper in config.test.mjs; P1.1/P1.2 own exactly the listed files.
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
  return result;
}

test("accepts a config whose references and parameters all resolve", () => {
  accepted(baseConfig());
});

test("rejects duplicate source ids", () => {
  const config = baseConfig();
  config.data.sources.push(structuredClone(config.data.sources[0]));
  rejectedWith(config, "source.duplicate-id", "data.sources[1].id");
});

test("rejects duplicate filter ids", () => {
  const config = baseConfig();
  config.filters.push(structuredClone(config.filters[0]));
  rejectedWith(config, "filter.duplicate-id", "filters[3].id");
});

test("rejects duplicate component ids", () => {
  const config = baseConfig();
  config.layout.push(structuredClone(config.layout[0]));
  rejectedWith(config, "component.duplicate-id", "layout[5].id");
});

test("rejects filters that reference unknown sources", () => {
  const config = baseConfig();
  config.filters[0].source = "products";
  rejectedWith(config, "source.unknown-id", "filters[0].source");
});

test("rejects filters that reference unknown columns", () => {
  const config = baseConfig();
  config.filters[0].column = "year_month_identifier";
  rejectedWith(config, "column.unknown", "filters[0].column");
});

test("rejects undeclared prototype-looking column references", () => {
  const config = baseConfig();
  config.filters[0].column = "constructor";
  rejectedWith(config, "column.unknown", "filters[0].column");
});

test("rejects case-insensitively duplicate source columns", () => {
  const config = baseConfig();
  config.data.sources[0].schema.Station = { type: "string", nullable: true };
  const result = rejectedWith(
    config,
    "column.duplicate-case-insensitive",
    "data.sources[0].schema",
  );
  assert.equal(
    result.issues.filter(
      (issue) => issue.code === "column.duplicate-case-insensitive",
    ).length,
    1,
  );
});

test("rejects case-insensitively duplicate unicode source columns", () => {
  const config = baseConfig();
  config.data.sources[0].schema["Café"] = { type: "string", nullable: true };
  config.data.sources[0].schema["café"] = { type: "string", nullable: true };
  rejectedWith(
    config,
    "column.duplicate-case-insensitive",
    "data.sources[0].schema",
  );
});

test("rejects text filters on non-string columns", () => {
  const config = baseConfig();
  config.filters[1].column = "inspection_date";
  rejectedWith(config, "filter.column-type", "filters[1]");
});

test("rejects date-range filters on non-temporal columns", () => {
  const config = baseConfig();
  config.filters[2].column = "station";
  rejectedWith(config, "filter.column-type", "filters[2]");
});

test("accepts select filters on every column type", () => {
  const config = baseConfig();
  config.filters = [
    {
      id: "f_str",
      kind: "select",
      source: "inspections",
      column: "station",
      default: null,
    },
    {
      id: "f_bool",
      kind: "select",
      source: "inspections",
      column: "is_last_measurement",
      default: null,
    },
    {
      id: "f_int",
      kind: "select",
      source: "inspections",
      column: "dut_seq",
      default: null,
    },
    {
      id: "f_num",
      kind: "select",
      source: "inspections",
      column: "failure_ratio",
      default: null,
    },
    {
      id: "f_date",
      kind: "select",
      source: "inspections",
      column: "inspection_day",
      default: null,
    },
    {
      id: "f_ts",
      kind: "select",
      source: "inspections",
      column: "inspection_date",
      default: null,
    },
  ];
  config.queries.summary.params = ["f_str"];
  accepted(config);
});

test("rejects reversed fixed date ranges", () => {
  const config = baseConfig();
  config.filters[2].default = {
    kind: "fixed",
    from: "2026-08-26",
    through: "2026-07-28",
  };
  rejectedWith(config, "date.reversed", "filters[2].default");
});

test("rejects fixed date ranges with invalid calendar dates", () => {
  const config = baseConfig();
  config.filters[2].default = {
    kind: "fixed",
    from: "2026-02-30",
    through: "2026-08-26",
  };
  rejectedWith(config, "date.invalid", "filters[2].default.from");
});

test("rejects malformed fixed date-range defaults", () => {
  const config = baseConfig();
  config.filters[2].default = { kind: "fixed", from: "2026-01-01" };
  rejectedWith(config, "filter.default-type", "filters[2].default");
  const config2 = baseConfig();
  config2.filters[2].default = {
    kind: "fixed",
    from: "2026-01-01",
    through: "2026-08-26",
    label: "x",
  };
  rejectedWith(config2, "filter.default-type", "filters[2].default");
});

test("rejects unsupported date-range default kinds", () => {
  const config = baseConfig();
  config.filters[2].default = { kind: "last-days", days: 30 };
  rejectedWith(config, "filter.default-type", "filters[2].default");
});

test("rejects latest-days defaults that are not positive safe integers", () => {
  for (const days of [0, -3, 1.5, "30", 2 ** 53]) {
    const config = baseConfig();
    config.filters[2].default = { kind: "latest-days", days };
    rejectedWith(
      config,
      "filter.default-type",
      "filters[2].default.days",
      `days=${String(days)}`,
    );
  }
});

test("rejects null and non-object date-range defaults", () => {
  const config = baseConfig();
  config.filters[2].default = null;
  rejectedWith(config, "filter.default-type", "filters[2].default");
  const config2 = baseConfig();
  config2.filters[2].default = "30d";
  rejectedWith(config2, "filter.default-type", "filters[2].default");
});

test("rejects select defaults whose type does not match the column", () => {
  const cases = [
    ["dut_seq", "42"],
    ["dut_seq", 1.5],
    ["dut_seq", 2 ** 53],
    ["failure_ratio", "0.5"],
    ["failure_ratio", Number.NaN],
    ["failure_ratio", Number.POSITIVE_INFINITY],
    ["is_last_measurement", "yes"],
    ["station", 5],
  ];
  for (const [column, badDefault] of cases) {
    const config = baseConfig();
    config.filters = [
      {
        id: "f",
        kind: "select",
        source: "inspections",
        column,
        default: badDefault,
      },
    ];
    config.queries.summary.params = ["f"];
    rejectedWith(
      config,
      "filter.default-type",
      "filters[0].default",
      `column=${column}`,
    );
  }
});

test("rejects select date defaults that are not calendar dates", () => {
  for (const badDefault of [
    "2026-02-30",
    "2026-8-26",
    "not-a-date",
    20260826,
  ]) {
    const config = baseConfig();
    config.filters = [
      {
        id: "f",
        kind: "select",
        source: "inspections",
        column: "inspection_day",
        default: badDefault,
      },
    ];
    config.queries.summary.params = ["f"];
    rejectedWith(
      config,
      "date.invalid",
      "filters[0].default",
      `default=${String(badDefault)}`,
    );
  }
});

test("rejects offset-bearing or out-of-range select timestamp defaults", () => {
  for (const badDefault of [
    "2026-08-26T12:26:34Z",
    "2026-08-26 25:00:00",
    "2026-08-26T12:26:34+02:00",
    "2026-08-26",
  ]) {
    const config = baseConfig();
    config.filters = [
      {
        id: "f",
        kind: "select",
        source: "inspections",
        column: "inspection_date",
        default: badDefault,
      },
    ];
    config.queries.summary.params = ["f"];
    rejectedWith(
      config,
      "date.invalid",
      "filters[0].default",
      `default=${badDefault}`,
    );
  }
});

test("preserves distinct null and empty-string defaults", () => {
  const config = baseConfig();
  config.filters[0].default = "";
  config.filters[1].default = "";
  accepted(config);
});

test("rejects queries that declare unknown parameters", () => {
  const config = baseConfig();
  config.queries.summary.params = ["product"];
  rejectedWith(config, "parameter.unknown", "queries.summary.params[0]");
});

test("rejects duplicate parameter declarations within a query", () => {
  const config = baseConfig();
  config.queries.summary.params = ["station", "station"];
  rejectedWith(config, "parameter.duplicate", "queries.summary.params[1]");
});

test("rejects colliding filter output parameter names", () => {
  const config = baseConfig();
  config.filters.push({
    id: "window_from",
    kind: "select",
    source: "inspections",
    column: "station",
    default: null,
  });
  rejectedWith(config, "parameter.collision", "filters[3].id");
});

test("rejects date-range filters whose outputs collide with a later filter", () => {
  const config = baseConfig();
  config.filters = [
    {
      id: "window_from",
      kind: "select",
      source: "inspections",
      column: "station",
      default: null,
    },
    { ...structuredClone(BASE_CONFIG.filters[2]) },
  ];
  config.queries.summary.params = ["window_from", "window_to"];
  rejectedWith(config, "parameter.collision", "filters[1].id");
});

test("rejects components that reference unknown queries", () => {
  const config = baseConfig();
  config.layout[0].query = "missing";
  rejectedWith(config, "query.unknown-id", "layout[0].query");
});

test("rejects table query ids referenced by other components", () => {
  const config = baseConfig();
  config.layout[0].query = "records";
  rejectedWith(config, "query.table-exclusive", "layout[0].query");
});

test("rejects two tables sharing one query", () => {
  const config = baseConfig();
  config.layout[2] = {
    id: "second_table",
    type: "table",
    query: "records",
    label: "Second table",
    columns: [{ field: "order_number", label: "Order" }],
  };
  rejectedWith(config, "query.table-exclusive", "layout[4].query");
});

test("accepts shared queries between chart components", () => {
  const config = baseConfig();
  config.layout[3].query = "timeline";
  accepted(config);
});

test("rejects invalid annotation calendar dates", () => {
  const config = baseConfig();
  config.layout[1].annotations[0].at = "2026-02-30";
  rejectedWith(config, "date.invalid", "layout[1].annotations[0].at");
});

test("treats prototype-like column names as ordinary own-property names", () => {
  const prototypeNamesBefore = Object.getOwnPropertyNames(Object.prototype);
  const config = JSON.parse(`{
    "contract": 1,
    "app": "grid",
    "title": "Prototype columns",
    "data": {
      "mode": "upload",
      "sources": [{
        "id": "s",
        "type": "json",
        "file": "s.json",
        "schema": {
          "__proto__": {"type": "string", "nullable": false},
          "constructor": {"type": "string", "nullable": false},
          "toString": {"type": "string", "nullable": false}
        }
      }]
    },
    "filters": [
      {"id": "f1", "kind": "select", "source": "s", "column": "__proto__", "default": null},
      {"id": "f2", "kind": "text", "source": "s", "column": "constructor", "default": null},
      {"id": "f3", "kind": "select", "source": "s", "column": "toString", "default": null}
    ],
    "queries": {"q": {"sql": "SELECT 1 AS x FROM s", "params": ["f1"]}},
    "layout": [{"id": "c", "type": "kpi", "query": "q", "field": "x", "label": "L"}]
  }`);
  const snapshot = JSON.stringify(config);
  const result = validateConfig(config);
  assert.ok(result.ok, JSON.stringify(result.issues ?? result));
  assert.equal(JSON.stringify(config), snapshot, "input must not be mutated");
  const schema = result.value.data.sources[0].schema;
  for (const name of ["__proto__", "constructor", "toString"]) {
    assert.ok(
      Object.hasOwn(schema, name),
      `column ${name} must stay an own property`,
    );
  }
  assert.equal(
    JSON.stringify(schema),
    JSON.stringify(config.data.sources[0].schema),
    "schema keys preserved",
  );
  assert.deepEqual(
    Object.getOwnPropertyNames(Object.prototype),
    prototypeNamesBefore,
    "Object.prototype must not be polluted",
  );
});

test("preserves quoted, unicode, and injection-looking column names verbatim", () => {
  const config = baseConfig();
  config.data.sources[0].schema = {
    café: { type: "string", nullable: false },
    'col"quoted': { type: "string", nullable: false },
    "drop table users;--": { type: "string", nullable: false },
    "<img src=x onerror=alert(1)>": { type: "integer", nullable: true },
  };
  config.filters = [
    {
      id: "f1",
      kind: "text",
      source: "inspections",
      column: "café",
      default: null,
    },
    {
      id: "f2",
      kind: "select",
      source: "inspections",
      column: "drop table users;--",
      default: null,
    },
  ];
  config.queries.summary.params = ["f1"];
  accepted(config);
  const schema = config.data.sources[0].schema;
  assert.deepEqual(Object.keys(schema), [
    "café",
    'col"quoted',
    "drop table users;--",
    "<img src=x onerror=alert(1)>",
  ]);
  assert.ok(Object.hasOwn(schema, "<img src=x onerror=alert(1)>"));
});

/**
 * P2.1 — browser harness, DuckDB-WASM engine boot, and parser capability gate.
 *
 * These tests run in the real installed desktop Chrome (`channel: 'chrome'`)
 * against the generated `file://` harness page. They prove, through the actual
 * pinned DuckDB-WASM worker, runtime readiness, a real `SELECT 1`, worker and
 * asset failure handling, disposal, and the `json_serialize_sql` /
 * `json_deserialize_sql` capability gate with named-parameter binding.
 * Nothing here mocks the engine; synthetic inputs only.
 */

import { test } from "@playwright/test";
import {
 assertFileOrigin,
 closeHarness,
 expect,
 openHarness,
 requireInstalledDesktopChrome,
} from "./helpers.mjs";

const PINNED_WORKER_404 =
 "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/dist/does-not-exist.worker.js";
const PINNED_WASM_404 =
 "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/dist/does-not-exist.wasm";
const PINNED_REAL_WASM =
 "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/dist/duckdb-eh.wasm";
const PINNED_REAL_WORKER =
 "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/dist/duckdb-browser-eh.worker.js";

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} expression
 */
async function harnessEval(page, expression) {
 return page.evaluate(`window.__featherbiHarness.${expression}`);
}

test.describe("P2.1 engine boot, worker failures, and disposal", () => {
 test.beforeAll(async ({ browser }) => {
  requireInstalledDesktopChrome(browser);
 });

 test("opens the generated harness over file:// in installed desktop Chrome", async ({
  browser,
 }) => {
  const { page, context } = await openHarness(browser);
  try {
   assertFileOrigin(page.url());
   const state = await page.getAttribute("#harness-status", "data-state");
   expect(state).toBe("ready");
   const userAgent = await page.evaluate(() => navigator.userAgent);
   expect(userAgent).toMatch(/Chrome\//);
   expect(userAgent).not.toMatch(/Chromium\//);
  } finally {
   await closeHarness(context);
  }
 });

 test("harness build metadata pins DuckDB-WASM 1.32.0 remote assets", async ({
  browser,
 }) => {
  const { page, context } = await openHarness(browser);
  try {
   const meta = await harnessEval(page, "meta");
   expect(meta.testOnly).toBe(true);
   expect(meta.duckdbWasm.version).toBe("1.32.0");
   const urls = JSON.stringify(meta.duckdbWasm.bundles);
   expect(urls).toContain("@duckdb/duckdb-wasm@1.32.0/dist/");
   expect(urls).not.toContain("latest");
   expect(meta.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
  } finally {
   await closeHarness(context);
  }
 });

 test("engine boots in the worker and records the DuckDB version", async ({
  browser,
 }) => {
  const { page, context } = await openHarness(browser);
  try {
   const { id, info } = await harnessEval(page, "createEngine()");
   try {
    expect(info.version).toMatch(/^v\d+\.\d+\.\d+/);
    expect(info.bundle.mainWorker).toContain("@duckdb/duckdb-wasm@1.32.0/");
    expect(info.bundle.mainModule).toContain("@duckdb/duckdb-wasm@1.32.0/");
    const events = await harnessEval(page, `statusLog('${id}')`);
    const phases = events.map((event) => event.phase);
    expect(phases).toContain("worker-created");
    expect(phases).toContain("instantiating");
    expect(phases).toContain("ready");
   } finally {
    await harnessEval(page, `dispose('${id}')`);
   }
  } finally {
   await closeHarness(context);
  }
 });

 test("executes SELECT 1 through the actual DuckDB-WASM worker", async ({
  browser,
 }) => {
  const { page, context } = await openHarness(browser);
  try {
   const { id } = await harnessEval(page, "createEngine()");
   try {
    const rows = await harnessEval(page, `query('${id}', 'SELECT 1 AS one')`);
    expect(rows).toEqual([{ one: 1 }]);
   } finally {
    await harnessEval(page, `dispose('${id}')`);
   }
  } finally {
   await closeHarness(context);
  }
 });

 test("propagates SQL execution errors from the worker", async ({
  browser,
 }) => {
  const { page, context } = await openHarness(browser);
  try {
   const { id } = await harnessEval(page, "createEngine()");
   try {
    await expect(
     harnessEval(page, `query('${id}', 'SELECT * FROM no_such_table')`),
    ).rejects.toThrow(/no_such_table|Catalog Error/i);
   } finally {
    await harnessEval(page, `dispose('${id}')`);
   }
  } finally {
   await closeHarness(context);
  }
 });

 test("worker bootstrap failure (unavailable worker script) rejects with the pinned URL", async ({
  browser,
 }) => {
  const { page, context } = await openHarness(browser);
  try {
   await expect(
    harnessEval(
     page,
     `createEngine({ urls: { mainWorker: '${PINNED_WORKER_404}', mainModule: '${PINNED_REAL_WASM}' } })`,
    ),
   ).rejects.toThrow(/does-not-exist\.worker\.js/);
  } finally {
   await closeHarness(context);
  }
 });

 test("unavailable WASM module rejects engine boot with the pinned URL", async ({
  browser,
 }) => {
  const { page, context } = await openHarness(browser);
  try {
   await expect(
    harnessEval(
     page,
     `createEngine({ urls: { mainWorker: '${PINNED_REAL_WORKER}', mainModule: '${PINNED_WASM_404}' } })`,
    ),
   ).rejects.toThrow(/does-not-exist\.wasm.*HTTP 404|module unavailable/i);
  } finally {
   await closeHarness(context);
  }
 });

 test("stalled module preflight is bounded by bootTimeoutMs and leaves no unhandled rejection", async ({
  browser,
 }) => {
  const { page, context } = await openHarness(browser);
  try {
   assertFileOrigin(page.url());
   const bootTimeoutMs = 1500;
   // RFC 5737 TEST-NET-3 is documentation-only space: nothing ever answers
   // there, so the real HEAD/range preflight connects and then stalls
   // forever (no mocks, no local server). Regression: the preflight used
   // to race only worker failure, hanging createEngine indefinitely.
   const stalledModule = "https://203.0.113.9/duckdb-eh.wasm";
   const startedAt = Date.now();
   await expect(
    harnessEval(
     page,
     `createEngine({ urls: { mainWorker: '${PINNED_REAL_WORKER}', mainModule: '${stalledModule}' }, bootTimeoutMs: ${bootTimeoutMs} })`,
    ),
   ).rejects.toThrow(
    new RegExp(`engine boot timed out after ${bootTimeoutMs} ms`),
   );
   const elapsed = Date.now() - startedAt;
   // The boot timeout (not the still-stalled fetch) settled the race, and
   // it settled quickly instead of hanging.
   expect(elapsed).toBeGreaterThanOrEqual(bootTimeoutMs);
   expect(elapsed).toBeLessThan(20_000);
   // The stalled probe fetch is aborted during boot-failure cleanup; give
   // any late rejection a moment to surface, then prove none was left
   // unhandled and the harness page stayed healthy.
   await page.waitForTimeout(750);
   expect(await harnessEval(page, "pageIssues()")).toEqual([]);
   expect(await page.getAttribute("#harness-status", "data-state")).toBe(
    "ready",
   );
  } finally {
   await closeHarness(context);
  }
 });

 test("ungraceful worker termination fails later queries", async ({
  browser,
 }) => {
  const { page, context } = await openHarness(browser);
  try {
   const { id } = await harnessEval(page, "createEngine()");
   try {
    const before = await harnessEval(page, `query('${id}', 'SELECT 2 AS two')`);
    expect(before).toEqual([{ two: 2 }]);
    await harnessEval(page, `terminateWorker('${id}')`);
    await expect(
     harnessEval(page, `query('${id}', 'SELECT 3 AS three')`),
    ).rejects.toThrow();
   } finally {
    await harnessEval(page, `dispose('${id}')`);
   }
  } finally {
   await closeHarness(context);
  }
 });

 test("disposal terminates the owned worker and is idempotent", async ({
  browser,
 }) => {
  const { page, context } = await openHarness(browser);
  try {
   const { id } = await harnessEval(page, "createEngine()");
   await harnessEval(page, `dispose('${id}')`);
   const state = await harnessEval(page, `engineState('${id}')`);
   expect(state.detached).toBe(true);
   await expect(harnessEval(page, `dispose('${id}')`)).resolves.toBeUndefined();
   await expect(
    harnessEval(page, `query('${id}', 'SELECT 4 AS four')`),
   ).rejects.toThrow();
   const events = await harnessEval(page, `statusLog('${id}')`);
   const phases = events.map((event) => event.phase);
   expect(phases).toContain("disposed");
  } finally {
   await closeHarness(context);
  }
 });
});

test.describe
 .serial("P2.1 capability gate: SQL AST and named parameters in the pinned WASM engine", () => {
  let page;
  let context;
  let engineId;

  test.beforeAll(async ({ browser }) => {
   requireInstalledDesktopChrome(browser);
   ({ page, context } = await openHarness(browser));
   const created = await harnessEval(page, "createEngine()");
   engineId = created.id;
  });

  test.afterAll(async () => {
   try {
    if (engineId) {
     await harnessEval(page, `dispose('${engineId}')`);
    }
   } finally {
    if (context) {
     await closeHarness(context);
    }
   }
  });

  /**
   * Serialize SQL through a prepared statement. The pinned engine requires an
   * explicit VARCHAR cast on the prepared parameter at bind time
   * (`json_serialize_sql(?)` alone is rejected with "first argument must be a
   * VARCHAR"); the SQL text itself still travels as a bound parameter.
   */
  async function serialize(/** @type {string} */ sql) {
   const rows = await harnessEval(
    page,
    `runPrepared('${engineId}', 'SELECT json_serialize_sql(CAST(? AS VARCHAR)) AS ast', [${JSON.stringify(sql)}])`,
   );
   return JSON.parse(rows[0].ast);
  }

  /** Read a serialized statement's named_param_map as a plain object. */
  function paramMap(/** @type {any} */ ast) {
   const entries = ast.statements[0].named_param_map ?? [];
   return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
  }

  test("json_serialize_sql(?) exposes SELECT node, CTE scope, join, table function, modifiers, and named_param_map", async () => {
   const sql = [
    "WITH recent AS (",
    "  SELECT station, product_id FROM read_parquet('synthetic-inspections.parquet')",
    "  WHERE measured_at >= $from_ts",
    ")",
    "SELECT r.station, p.product_name",
    "FROM recent r",
    "JOIN products p ON r.product_id = p.product_id",
    "WHERE r.station <> $excluded_station",
    "ORDER BY r.station",
    "LIMIT 10",
   ].join("\n");
   const ast = await serialize(sql);
   expect(ast.error).toBeFalsy();
   expect(ast.statements).toHaveLength(1);
   const node = ast.statements[0].node;
   expect(node.type).toBe("SELECT_NODE");

   // CTE scope: the `recent` CTE carries its own SELECT with the table-function read.
   expect(node.cte_map.map).toHaveLength(1);
   expect(node.cte_map.map[0].key).toBe("recent");
   const cteRead = node.cte_map.map[0].value.query.node.from_table;
   expect(cteRead.type).toBe("TABLE_FUNCTION");
   expect(cteRead.function.function_name).toBe("read_parquet");

   // Join against the `products` base table.
   expect(node.from_table.type).toBe("JOIN");
   expect(node.from_table.join_type).toBe("INNER");
   expect(JSON.stringify(node.from_table)).toContain("BASE_TABLE");
   expect(JSON.stringify(node.from_table)).toContain("products");

   // Modifiers and where clause are inspectable.
   expect(node.where_clause.type).toBe("COMPARE_NOTEQUAL");
   expect(node.modifiers.map((m) => m.type)).toEqual(
    expect.arrayContaining(["ORDER_MODIFIER", "LIMIT_MODIFIER"]),
   );

   // Named parameters map to one-based ordinals by first appearance.
   expect(paramMap(ast)).toEqual({
    from_ts: 1,
    excluded_station: 2,
   });
  });

  test("json_serialize_sql(?) handles multiple SELECTs (set operation) and explicitly rejects DDL and multi-statement input", async () => {
   const setOperation = await serialize(
    "SELECT $a AS x UNION ALL SELECT $b AS x ORDER BY x",
   );
   expect(setOperation.error).toBeFalsy();
   expect(setOperation.statements).toHaveLength(1);
   expect(setOperation.statements[0].node.type).toBe("SET_OPERATION_NODE");
   expect(
    setOperation.statements[0].node.modifiers.map((m) => m.type),
   ).toContain("ORDER_MODIFIER");
   expect(paramMap(setOperation)).toEqual({ a: 1, b: 2 });

   const ddl = await serialize("CREATE TABLE gate_ddl_probe(a INT)");
   expect(ddl.error).toBe(true);
   expect(ddl.error_type).toBe("not implemented");
   expect(ddl.error_message).toMatch(
    /Only SELECT statements can be serialized to json!/,
   );

   const multiStatement = await serialize(
    "CREATE TABLE gate_ddl_probe(a INT); SELECT a FROM gate_ddl_probe",
   );
   expect(multiStatement.error).toBe(true);
   expect(multiStatement.error_message).toMatch(/Only SELECT statements/);

   // Serialization must not execute the DDL: the table must not exist.
   await expect(
    harnessEval(
     page,
     `query('${engineId}', 'SELECT count(*) FROM gate_ddl_probe')`,
    ),
   ).rejects.toThrow(/gate_ddl_probe|Catalog Error/i);
  });

  test("json_deserialize_sql(?) round-trips the original serialized JSON to executable canonical SQL", async () => {
   // Use the ORIGINAL serialized JSON string: re-stringifying a parsed AST in
   // JavaScript corrupts uint64 values (query_location 18446744073709551615)
   // and the engine rejects the result with a uint64 parser error.
   const rawRows = await harnessEval(
    page,
    `runPrepared('${engineId}', 'SELECT json_serialize_sql(CAST(? AS VARCHAR)) AS ast', ['SELECT ? + 1 AS incremented'])`,
   );
   const ast = JSON.parse(rawRows[0].ast);
   expect(ast.error).toBeFalsy();
   const deserialized = await harnessEval(
    page,
    `runPrepared('${engineId}', 'SELECT json_deserialize_sql(CAST(? AS VARCHAR)) AS sql', [${JSON.stringify(
     rawRows[0].ast,
    )}])`,
   );
   const canonical = deserialized[0].sql;
   // Canonical SQL rewrites anonymous `?` as the positional `$1` parameter.
   expect(canonical).toBe("SELECT ($1 + 1) AS incremented");
   // The canonical SQL from the engine executes through a prepared statement,
   // binding the positional parameter through the worker bridge.
   const rows = await harnessEval(
    page,
    `runPrepared('${engineId}', ${JSON.stringify(canonical)}, [41])`,
   );
   expect(Number(rows[0].incremented)).toBe(42);

   // Named placeholders survive the round trip in canonical SQL.
   const namedRows = await harnessEval(
    page,
    `runPrepared('${engineId}', 'SELECT json_serialize_sql(CAST(? AS VARCHAR)) AS ast', ['SELECT $answer + 1 AS incremented'])`,
   );
   const namedDeserialized = await harnessEval(
    page,
    `runPrepared('${engineId}', 'SELECT json_deserialize_sql(CAST(? AS VARCHAR)) AS sql', [${JSON.stringify(
     namedRows[0].ast,
    )}])`,
   );
   expect(namedDeserialized[0].sql).toBe("SELECT ($answer + 1) AS incremented");
  });

  test("named_param_map binding order holds for repeated and reordered placeholders; named values cannot be bound through the positional bridge", async () => {
   // Repeated placeholder: one parameter, one ordinal.
   const repeated = await serialize(
    "SELECT $first AS f, $second AS s, $first AS f2",
   );
   expect(paramMap(repeated)).toEqual({ first: 1, second: 2 });

   // Reordered placeholders: ordinals follow first textual appearance.
   const reordered = await serialize(
    "SELECT $second AS s, $first AS f, $second AS s2",
   );
   expect(paramMap(reordered)).toEqual({ second: 1, first: 2 });

   // Ordinal semantics: binding the canonical positional `$N` form with
   // map-ordered values puts each value in the right slot, including repeats.
   // ($1 reused binds one value to both occurrences; each `?` would instead
   // be a distinct parameter.)
   const repeatedRows = await harnessEval(
    page,
    `runPrepared('${engineId}', 'SELECT $1 AS f, $2 AS s, $1 AS f2', ['A', 'B'])`,
   );
   expect(repeatedRows).toEqual([{ f: "A", s: "B", f2: "A" }]);
   // Binding follows declared ordinals ($1, $2), not textual appearance order.
   const reorderedRows = await harnessEval(
    page,
    `runPrepared('${engineId}', 'SELECT $2 AS s, $1 AS f, $2 AS s2', ['A', 'B'])`,
   );
   expect(reorderedRows).toEqual([{ s: "B", f: "A", s2: "B" }]);

   // Documented engine boundary for P3.1: the duckdb-wasm bridge binds values
   // by one-based ordinal keys only ("1", "2", ...), so a statement with named
   // placeholders rejects positional values with this exact engine error.
   await expect(
    harnessEval(
     page,
     `runPrepared('${engineId}', 'SELECT $first AS f, $second AS s', ['A', 'B'])`,
    ),
   ).rejects.toThrow(
    /Values were not provided for the following prepared statement parameters: first, second/,
   );
  });
 });

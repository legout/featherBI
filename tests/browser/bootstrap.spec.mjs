/**
 * Slim engine smoke: the harness boots over file:// in installed Chrome, the
 * real DuckDB-WASM worker executes SQL, errors surface, disposal is
 * idempotent, and the SQL-AST capability the MVP query gate relies on works.
 * Failure-probe matrices (404 assets, stalled preflight, ungraceful kill) were
 * pruned — they guard infrastructure that is already pinned and recorded.
 */

import { test } from "@playwright/test";
import {
 assertFileOrigin,
 closeHarness,
 expect,
 openHarness,
 requireInstalledDesktopChrome,
} from "./helpers.mjs";

async function harnessEval(page, expression) {
 return page.evaluate(`window.__featherbiHarness.${expression}`);
}

test.describe("engine boot and query smoke", () => {
 test.beforeAll(async ({ browser }) => {
  requireInstalledDesktopChrome(browser);
 });

 test("harness opens over file:// in desktop Chrome and reports ready", async ({ browser }) => {
  const { page, context } = await openHarness(browser);
  try {
   assertFileOrigin(page.url());
   expect(await page.getAttribute("#harness-status", "data-state")).toBe("ready");
   const userAgent = await page.evaluate(() => navigator.userAgent);
   expect(userAgent).toMatch(/Chrome\//);
   expect(userAgent).not.toMatch(/Chromium\//);
  } finally {
   await closeHarness(context);
  }
 });

 test("engine boots and executes SELECT 1 through the real worker", async ({ browser }) => {
  const { page, context } = await openHarness(browser);
  try {
   const { id, info } = await harnessEval(page, "createEngine()");
   try {
    expect(info.version).toMatch(/^v\d+\.\d+\.\d+/);
    expect(await harnessEval(page, `query('${id}', 'SELECT 1 AS one')`)).toEqual([{ one: 1 }]);
   } finally {
    await harnessEval(page, `dispose('${id}')`);
   }
  } finally {
   await closeHarness(context);
  }
 });

 test("SQL errors propagate instead of hanging", async ({ browser }) => {
  const { page, context } = await openHarness(browser);
  try {
   const { id } = await harnessEval(page, "createEngine()");
   try {
    await expect(harnessEval(page, `query('${id}', 'SELECT * FROM no_such_table')`)).rejects.toThrow();
   } finally {
    await harnessEval(page, `dispose('${id}')`);
   }
  } finally {
   await closeHarness(context);
  }
 });

 test("disposal is idempotent", async ({ browser }) => {
  const { page, context } = await openHarness(browser);
  try {
   const { id } = await harnessEval(page, "createEngine()");
   await harnessEval(page, `dispose('${id}')`);
   await harnessEval(page, `dispose('${id}')`);
   expect((await harnessEval(page, `engineState('${id}')`)).disposed).toBe(true);
  } finally {
   await closeHarness(context);
  }
 });

 test("json_serialize_sql capability works with a bound parameter", async ({ browser }) => {
  const { page, context } = await openHarness(browser);
  try {
   const { id } = await harnessEval(page, "createEngine()");
   try {
    const rows = await harnessEval(
     page,
     `runPrepared('${id}', 'SELECT json_serialize_sql(CAST(? AS VARCHAR)) AS ast', ['SELECT count(*) AS c FROM inspections WHERE station = $p'])`,
    );
    const ast = JSON.parse(rows[0].ast);
    expect(ast.error).toBeFalsy();
    expect(ast.statements).toHaveLength(1);
    expect(ast.statements[0].node.type).toBe("SELECT_NODE");
   } finally {
    await harnessEval(page, `dispose('${id}')`);
   }
  } finally {
   await closeHarness(context);
  }
 });
});

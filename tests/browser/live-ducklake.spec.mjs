/**
 * Live DuckLake source (spec 2026-10-19-0005 §5, SL-06; ADR 0009 pinned
 * artifact trust): `remote: {kind: ducklake, uri, table, auth: none}`
 * exposes one explicitly named table of a public HTTPS catalog. The
 * integrated dashboard attaches the catalog through the trusted runtime's
 * `ducklake:<uri>` string, loads the owner-approved pinned DuckLake
 * capability (G3: exact artifact URL and SHA-256, ADR 0009), and reads the
 * named table live in desktop Chrome without any prompt — the S2 evidence
 * value (85 astronaut rows) is the independent oracle
 * (project/research/ducklake-extension-gate-probe.md).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "@playwright/test";
import { renderDashboard } from "../../scripts/build.mjs";
import { DUCKDB_DUCKLAKE_CAPABILITY } from "../../runtime/bootstrap.mjs";
import {
 closeHarness,
 expect,
 openHarness,
 requireInstalledDesktopChrome,
 rootDir,
} from "./helpers.mjs";

/** The S2-proven public catalog and its explicitly named table. */
const CATALOG_URI = "https://raw.githubusercontent.com/marhar/frozen/main/space.ducklake";
const TABLE = "astronauts";
/** Independent expected result from the S2 gate evidence (not runtime output). */
const EXPECTED_ROWS = 85;

function ducklakeDashboardConfig() {
 return {
  contract: 2,
  app: "grid",
  title: "Live DuckLake table",
  data: {
   mode: "upload",
   sources: [
    {
     id: "astronauts",
     schema: {
      astronaut_id: { type: "integer", nullable: true },
      name: { type: "string", nullable: true },
     },
     remote: {
      kind: "ducklake",
      uri: CATALOG_URI,
      table: TABLE,
      auth: "none",
     },
    },
   ],
  },
  filters: [],
  queries: {
   records: {
    sql: "SELECT count(*) AS records FROM astronauts",
    params: [],
   },
  },
  layout: [
   {
    id: "kpi_records",
    type: "kpi",
    query: "records",
    field: "records",
    label: "Astronauts",
    x: 1,
    y: 1,
    width: 12,
    height: 1,
   },
  ],
  theme: "neutral",
 };
}

test.beforeAll(async ({ browser }) => {
 requireInstalledDesktopChrome(browser);
});

test("a public ducklake catalog opens live in Chrome through the pinned capability", async ({
 browser,
}) => {
 const context = await browser.newContext();
 const page = await context.newPage();
 try {
  const config = ducklakeDashboardConfig();
  const { html } = await renderDashboard({ config });
  // The artifact declares only the public identity and records the exact
  // owner-approved DuckLake capability (ADR 0009 G3) — never credentials.
  expect(html).toContain(CATALOG_URI);
  const build = JSON.parse(
   /window\.__featherbiBuild = (\{.*?\});\n/s.exec(html)?.[1] ?? "null",
  );
  const recorded = build?.capabilities?.find(({ id }) => id === "ducklake");
  expect(recorded).toEqual(DUCKDB_DUCKLAKE_CAPABILITY);

  const pagePath = path.join(rootDir, ".artifacts", "browser", "live-ducklake.html");
  await mkdir(path.dirname(pagePath), { recursive: true });
  await writeFile(pagePath, html, "utf8");
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load" });

  // A public catalog with auth: none opens with no dialog at all, and the
  // named table reads the S2 evidence value live.
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#component-kpi_records [data-value]")).toHaveText(
   String(EXPECTED_ROWS),
  );
 } finally {
  await context.close();
 }
});

test("a missing named table after a successful attach rolls the candidate back with no catalog left attached", async ({
 browser,
}) => {
 const { page, context } = await openHarness(browser);
 const call = (method, ...args) =>
  page.evaluate(
   ({ method: name, args: values }) => window.__featherbiHarness[name](...values),
   { method, args },
  );
 try {
  const { id } = await call("createEngine");
  try {
   // The S2-proven catalog attaches, but its named table does not exist,
   // so the candidate generation fails after the successful ATTACH.
   const missing = {
    id: "astronauts",
    schema: { astronaut_id: { type: "integer", nullable: true } },
    remote: {
     kind: "ducklake",
     uri: CATALOG_URI,
     table: "no_such_table",
     auth: "none",
    },
   };
   await expect(
    call("registerSources", id, [{ source: missing }]),
   ).rejects.toThrow(/cannot read the DuckLake table "no_such_table"/);
   const attached = await call(
    "query",
    id,
    "SELECT database_name FROM duckdb_databases() WHERE database_name LIKE '__featherbi_ducklake%'",
   );
   expect(attached).toEqual([]);
  } finally {
   await call("dispose", id);
  }
 } finally {
  await closeHarness(context);
 }
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "@playwright/test";
import {
 closeHarness,
 expect,
 openHarness,
 requireInstalledDesktopChrome,
 rootDir,
} from "./helpers.mjs";

async function harnessCall(page, method, ...args) {
 return page.evaluate(
  ({ method: call, args: values }) =>
   window.__featherbiHarness[call](...values),
  { method, args },
 );
}

async function fixtureInputs() {
 const config = JSON.parse(
  await readFile(path.join(rootDir, "tests/fixtures/runtime.config.json"), "utf8"),
 );
 const inputs = [];
 for (const source of config.data.sources) {
  const bytes = await readFile(
   path.join(rootDir, ".artifacts/fixtures", source.file),
  );
  inputs.push({
   source,
   bytes: { encoding: "base64", value: bytes.toString("base64") },
  });
 }
 return { config, inputs };
}

test.beforeAll(async ({ browser }) => {
 requireInstalledDesktopChrome(browser);
});

test("loads fixture sources and joins their typed logical views", async ({
 browser,
}) => {
 const { page, context } = await openHarness(browser);
 try {
  const { config, inputs } = await fixtureInputs();
  const expected = JSON.parse(
   await readFile(path.join(rootDir, "tests/fixtures/expected.json"), "utf8"),
  );
  const { id } = await harnessCall(page, "createEngine");
  try {
   await harnessCall(page, "registerSources", id, inputs);

   const count = await harnessCall(
    page,
    "query",
    id,
    "SELECT CAST(count(*) AS INTEGER) AS row_count FROM inspections",
   );
   expect(count).toEqual([
    { row_count: expected.canonical.rowCount },
   ]);

   const joinCounts = await harnessCall(
    page,
    "query",
    id,
    `SELECT
       CAST(count(*) FILTER (WHERE p.product_mlfb IS NOT NULL) AS INTEGER) AS matched,
       CAST(count(*) FILTER (WHERE p.product_mlfb IS NULL) AS INTEGER) AS unmatched,
       CAST((SELECT count(*) FROM products p
             LEFT JOIN inspections i ON i.product_mlfb = p.product_mlfb
             WHERE i.product_mlfb IS NULL) AS INTEGER) AS unmatched_products
     FROM inspections i
     LEFT JOIN products p ON i.product_mlfb = p.product_mlfb`,
   );
   expect(joinCounts).toEqual([
    {
     matched: expected.join.allRows.matchedInspectionRows,
     unmatched: expected.join.allRows.unmatchedInspectionRows,
     unmatched_products: expected.join.allRows.unmatchedProductRows,
    },
   ]);

   const labels = await harnessCall(
    page,
    "query",
    id,
    `SELECT DISTINCT i.product_mlfb, p.product_label
     FROM inspections i
     JOIN products p ON i.product_mlfb = p.product_mlfb
     ORDER BY i.product_mlfb`,
   );
   expect(Object.fromEntries(labels.map((row) => [row.product_mlfb, row.product_label]))).toEqual(
    expected.join.allRows.labels,
   );

   const schema = await harnessCall(
    page,
    "query",
    id,
    "SELECT typeof(inspection_date) AS inspection_type, typeof(is_last_measurement) AS flag_type FROM inspections LIMIT 1",
   );
   expect(schema[0]).toEqual({ inspection_type: "TIMESTAMP", flag_type: "BOOLEAN" });
   expect(config.data.sources.map((source) => source.id)).toEqual([
    "inspections",
    "products",
   ]);
  } finally {
   await harnessCall(page, "dispose", id);
  }
 } finally {
  await closeHarness(context);
 }
});

test("shows a visible error for a missing declared column", async ({ browser }) => {
 const { page, context } = await openHarness(browser);
 try {
  const { id } = await harnessCall(page, "createEngine");
  try {
   const source = {
    id: "broken",
    type: "csv",
    file: "broken.csv",
    schema: {
     present: { type: "string", nullable: false },
     required: { type: "string", nullable: false },
    },
   };
   await expect(
    harnessCall(
     page,
     "registerSources",
     id,
     [{
      source,
      bytes: { encoding: "base64", value: Buffer.from("present\nok\n").toString("base64") },
     }],
    ),
   ).rejects.toThrow('missing declared column "required"');
   await expect(page.locator("#harness-status")).toHaveAttribute(
    "data-state",
    "error",
   );
   await expect(page.locator("#harness-status")).toContainText(
    'missing declared column "required"',
   );
  } finally {
   await harnessCall(page, "dispose", id);
  }
 } finally {
  await closeHarness(context);
 }
});

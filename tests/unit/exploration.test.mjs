import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { compileProject } from "../../authoring/compiler.mjs";
import { validateConfig } from "../../contract/config.mjs";
import { resolveCapabilities, renderDashboard } from "../../scripts/build.mjs";
import { RESULT_MAX_BYTES, RESULT_MAX_ROWS, RESULT_TIMEOUT_MS } from "../../runtime/queries.mjs";
import { loadPerspectiveTable } from "../../runtime/perspective-table.mjs";
import { perspectiveConfigForChart } from "../../runtime/viewer.mjs";

const basic = path.resolve("examples/basic-dashboard/dashboard.yaml");
const exploration = path.resolve("examples/exploration-dashboard/dashboard.yaml");

test("exploration project compiles only typed Community, Perspective, and playground options", async () => {
 assert.deepEqual([RESULT_MAX_ROWS, RESULT_MAX_BYTES, RESULT_TIMEOUT_MS], [10_000, 8 * 1024 * 1024, 30_000]);
 const { config } = await compileProject(exploration);
 assert.equal(config.rendererPreset, "perspective-first");
 assert.deepEqual(config.layout.find(({ id }) => id === "explore").perspective, {
  plugin: "Y Bar",
  groupBy: ["station"],
  columns: ["amount"],
 });
 assert.deepEqual(config.playground.schemas.inspections, ["station", "amount"]);
 assert.deepEqual(config.playground.schemas.inspection_model, ["station", "amount"]);
 assert.equal(config.playground.renderer, "ag-grid");
 const enterprise = structuredClone(config);
 enterprise.layout.find(({ type }) => type === "table").rowGroup = true;
 assert.equal(validateConfig(enterprise).ok, false);

 const yaml = await readFile(exploration, "utf8");
 assert.doesNotMatch(yaml, /enterprise|rowGroup|pivotMode|serverSide/i);
});

test("capability builds are deterministic and omit unused heavy packages", async () => {
 const basicConfig = (await compileProject(basic)).config;
 const expandedConfig = (await compileProject(exploration)).config;
 assert.deepEqual(resolveCapabilities(basicConfig).map(({ id }) => id), ["core"]);
 assert.deepEqual(resolveCapabilities(expandedConfig).map(({ id }) => id), ["core", "ag-grid", "perspective", "codemirror"]);

 const first = await renderDashboard({ config: basicConfig });
 const second = await renderDashboard({ config: basicConfig });
 assert.equal(first.html, second.html);
 assert.equal(first.bundleSha256, second.bundleSha256);
 assert.deepEqual(first.capabilities, second.capabilities);
 for (const absent of ["@finos/perspective", "@codemirror/", "daisyui", "@siemens/ix", "ag-grid-community"]) {
  assert.equal(Object.keys(first.metafile.inputs).some((name) => name.includes(absent)), false, absent);
 }

 const expanded = await renderDashboard({ config: expandedConfig });
 const expandedAgain = await renderDashboard({ config: expandedConfig });
 assert.equal(expanded.html, expandedAgain.html);
 assert.equal(expanded.bundleSha256, expandedAgain.bundleSha256);
 for (const present of ["@finos/perspective", "@codemirror/", "ag-grid-community"]) {
  assert.equal(Object.keys(expanded.metafile.inputs).some((name) => name.includes(present)), true, present);
 }
 assert.equal(Object.keys(expanded.metafile.inputs).some((name) => name.includes("ag-grid-enterprise")), false);
});

test("perspective-first mapping keeps every authored field for heatmap, sankey, and boxplot", () => {
 assert.deepEqual(
  perspectiveConfigForChart({ type: "heatmap", xField: "station", yField: "band", value: "total" }),
  { plugin: "Datagrid", columns: ["station", "band", "total"] },
 );
 assert.deepEqual(
  perspectiveConfigForChart({ type: "sankey", source: "from_stage", target: "to_stage", value: "amount" }),
  { plugin: "Datagrid", columns: ["from_stage", "to_stage", "amount"] },
 );
 assert.deepEqual(
  perspectiveConfigForChart({ type: "boxplot", xField: "station", min: "min_amount", q1: "q1_amount", median: "median_amount", q3: "q3_amount", max: "max_amount" }),
  { plugin: "Datagrid", columns: ["station", "min_amount", "q1_amount", "median_amount", "q3_amount", "max_amount"] },
 );
 assert.deepEqual(
  perspectiveConfigForChart({ type: "heatmap", xField: "station", yField: "station", value: "station" }),
  { plugin: "Datagrid", columns: ["station"] },
 );
});

test("perspective-first mapping preserves established bar, pie, and gauge configs", () => {
 assert.deepEqual(
  perspectiveConfigForChart({ type: "bar", xField: "station", yField: "amount", series: "day" }),
  { plugin: "Y Bar", groupBy: ["station"], splitBy: ["day"], columns: ["amount"] },
 );
 assert.deepEqual(
  perspectiveConfigForChart({ type: "line", x: "station", y: "amount" }),
  { plugin: "Y Bar", groupBy: ["station"], splitBy: [], columns: ["amount"] },
 );
 assert.deepEqual(
  perspectiveConfigForChart({ type: "pie", name: "station", value: "amount" }),
  { plugin: "Y Bar", groupBy: ["station"], columns: ["amount"] },
 );
 assert.deepEqual(
  perspectiveConfigForChart({ type: "gauge", value: "amount" }),
  { plugin: "Datagrid", columns: ["amount"] },
 );
});

test("Perspective deletes a newly created table when load or restore fails", async () => {
 for (const failure of ["load", "restore"]) {
  let deleted = 0;
  const table = { async delete() { deleted += 1; } };
  const viewer = {
   async load() { if (failure === "load") throw new Error("load failed"); },
   async restore() { if (failure === "restore") throw new Error("restore failed"); },
  };
  await assert.rejects(
   () => loadPerspectiveTable(viewer, table, { plugin: "Datagrid", columns: ["station"] }),
   new RegExp(`${failure} failed`),
  );
  assert.equal(deleted, 1, `${failure} failure must delete the new table`);
 }
});

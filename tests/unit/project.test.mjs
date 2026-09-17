import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileProject } from "../../authoring/compiler.mjs";
import { validateConfig } from "../../contract/config.mjs";

async function project(overrides = {}) {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-project-"));
 await mkdir(path.join(dir, "queries"));
 const yaml = overrides.yaml ?? `project: 1
title: Example dashboard
sources:
  - id: inspections
    type: json
    file: inspections.json
    schema:
      station: {type: string, nullable: false}
      amount: {type: number, nullable: true}
filters: []
relationships: []
queries:
  total:
    sql: queries/total.sql
    params: []
layout:
  - id: total
    type: kpi
    query: total
    label: Total
    field: value
`;
 await writeFile(path.join(dir, "dashboard.yaml"), yaml);
 if (overrides.sql !== null) {
  await writeFile(
   path.join(dir, "queries", "total.sql"),
   overrides.sql ?? "SELECT count(*) AS value FROM inspections\n",
  );
 }
 return { dir, dashboard: path.join(dir, "dashboard.yaml") };
}

test("manual YAML and external SQL compile deterministically to strict contract 2", async () => {
 const { dir, dashboard } = await project();
 await mkdir(path.join(dir, ".featherbi"));
 const privatePath = "/private/author/data/inspections.json";
 await writeFile(
  path.join(dir, ".featherbi", "local-sources.yaml"),
  `inspections: ${privatePath}\n`,
 );

 const first = await compileProject(dashboard);
 const second = await compileProject(dashboard);
 assert.equal(first.json, second.json);
 assert.deepEqual(first.config, {
  contract: 2,
  app: "grid",
  title: "Example dashboard",
  data: {
   mode: "upload",
   sources: [{
    id: "inspections",
    type: "json",
    file: "inspections.json",
    schema: {
     station: { type: "string", nullable: false },
     amount: { type: "number", nullable: true },
    },
   }],
  },
  filters: [],
  queries: {
   total: {
    sql: "SELECT count(*) AS value FROM inspections\n",
    params: [],
   },
  },
  layout: [{
   id: "total",
   type: "kpi",
   query: "total",
   label: "Total",
   field: "value",
  }],
 });
 assert.equal(validateConfig(first.config).ok, true);
 assert.equal(first.json.includes(privatePath), false);
 assert.equal(first.json.includes("queries/total.sql"), false);
});

test("contract 1 stays accepted and unsupported or unknown runtime fields fail", async () => {
 const v1 = JSON.parse(
  await readFile(new URL("../fixtures/minimal.config.json", import.meta.url), "utf8"),
 );
 assert.equal(validateConfig(v1).ok, true);
 assert.equal(validateConfig({ ...v1, contract: 3 }).ok, false);
 const v2 = { ...(await compileProject((await project()).dashboard)).config, mystery: true };
 assert.equal(validateConfig(v2).ok, false);
});

test("project errors identify source location and cause", async () => {
 const cases = [
  {
   yaml: "project: [\n",
   match: /dashboard\.yaml:1:\d+.*YAML/i,
  },
  {
   yaml: `project: 1\ntitle: Example\nsources: []\nfilters: []\nqueries: {}\nlayout: []\nmystery: true\n`,
   match: /dashboard\.yaml:7:1.*additional property/i,
  },
  {
   yaml: `project: 1\ntitle: Example\nsources:\n  - id: inspections\n    type: json\n    file: inspections.json\n    schema: {station: {type: string, nullable: false}}\nfilters: []\nrelationships: []\nqueries:\n  total: {sql: ../escape.sql, params: []}\nlayout:\n  - {id: total, type: kpi, query: total, label: Total, field: value}\n`,
   match: /dashboard\.yaml:11:\d+.*queries\//i,
  },
  {
   sql: "DELETE FROM inspections\n",
   match: /queries\/total\.sql:1:1.*SELECT/i,
  },
  {
   sql: "SELECT * FROM unknown_source\n",
   match: /queries\/total\.sql:1:\d+.*undeclared source/i,
  },
  {
   sql: "SELECT * FROM inspections; SELECT 1\n",
   match: /queries\/total\.sql:1:\d+.*one statement/i,
  },
  {
   sql: "SELECT * FROM read_csv_auto('/tmp/private.csv')\n",
   match: /queries\/total\.sql:1:\d+.*file reader/i,
  },
  {
   sql: "SELECT * FROM inspections JOIN inspections AS other USING (station)\n",
   match: /queries\/total\.sql:1:\d+.*confirmed relationship/i,
  },
 ];
 for (const fixture of cases) {
  const { dashboard } = await project(fixture);
  await assert.rejects(() => compileProject(dashboard), fixture.match);
 }
});

test("a declared confirmed relationship admits a join", async () => {
 const { dashboard } = await project({
  yaml: `project: 1\ntitle: Joined example\nsources:\n  - id: inspections\n    type: json\n    file: inspections.json\n    schema: {product_id: {type: string, nullable: false}}\n  - id: products\n    type: json\n    file: products.json\n    schema: {product_id: {type: string, nullable: false}}\nfilters: []\nrelationships:\n  - {left: inspections, right: products, leftKey: product_id, rightKey: product_id, cardinality: many-to-one, confirmed: true}\nqueries:\n  total: {sql: queries/total.sql, params: []}\nlayout:\n  - {id: total, type: kpi, query: total, label: Total, field: value}\n`,
  sql: "SELECT count(*) AS value FROM inspections JOIN products USING (product_id)\n",
 });
 assert.equal((await compileProject(dashboard)).config.contract, 2);
});

test("unknown project versions and missing query files fail precisely", async () => {
 const unsupported = await project({
  yaml: `project: 2\ntitle: Example\nsources: []\nfilters: []\nqueries: {}\nlayout: []\n`,
 });
 await assert.rejects(
  () => compileProject(unsupported.dashboard),
  /dashboard\.yaml:1:10.*must be 1/i,
 );
 const missing = await project({ sql: null });
 await assert.rejects(
  () => compileProject(missing.dashboard),
  /queries\/total\.sql:1:1.*cannot read/i,
 );
});

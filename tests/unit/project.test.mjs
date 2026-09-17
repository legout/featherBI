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
 const yaml =
  overrides.yaml ??
  `project: 1
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
    x: 1
    y: 1
    width: 12
    height: 1
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
  theme: "neutral",
  rendererPreset: "standard",
  data: {
   mode: "upload",
   sources: [
    {
     id: "inspections",
     type: "json",
     file: "inspections.json",
     schema: {
      station: { type: "string", nullable: false },
      amount: { type: "number", nullable: true },
     },
    },
   ],
  },
  filters: [],
  queries: {
   total: {
    sql: "SELECT count(*) AS value FROM inspections\n",
    params: [],
   },
  },
  layout: [
   {
    id: "total",
    type: "kpi",
    query: "total",
    label: "Total",
    field: "value",
    x: 1,
    y: 1,
    width: 12,
    height: 1,
   },
  ],
 });
 assert.equal(validateConfig(first.config).ok, true);
 assert.equal(first.json.includes(privatePath), false);
 assert.equal(first.json.includes("queries/total.sql"), false);
});

test("removed contract 1 runtime configs are rejected and unknown fields fail", async () => {
 const v1 = JSON.parse(
  await readFile(
   new URL("../fixtures/minimal.config.json", import.meta.url),
   "utf8",
  ),
 );
 assert.equal(validateConfig({ ...v1, contract: 1 }).ok, false);
 const v2 = {
  ...(await compileProject((await project()).dashboard)).config,
  mystery: true,
 };
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
   yaml: `project: 1\ntitle: Example\nsources:\n  - id: inspections\n    type: json\n    file: inspections.json\n    schema: {station: {type: string, nullable: false}}\nfilters: []\nrelationships: []\nqueries:\n  total: {sql: ../escape.sql, params: []}\nlayout:\n  - {id: total, type: kpi, query: total, label: Total, field: value, x: 1, y: 1, width: 12, height: 1}\n`,
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
  yaml: `project: 1\ntitle: Joined example\nsources:\n  - id: inspections\n    type: json\n    file: inspections.json\n    schema: {product_id: {type: string, nullable: false}}\n  - id: products\n    type: json\n    file: products.json\n    schema: {product_id: {type: string, nullable: false}}\nfilters: []\nrelationships:\n  - {left: inspections, right: products, leftKey: product_id, rightKey: product_id, cardinality: many-to-one, confirmed: true}\nqueries:\n  total: {sql: queries/total.sql, params: []}\nlayout:\n  - {id: total, type: kpi, query: total, label: Total, field: value, x: 1, y: 1, width: 12, height: 1}\n`,
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

async function remoteProject(remote) {
 return project({
  yaml: `project: 1\ntitle: Remote dashboard\nsources:\n  - id: inspections\n    schema:\n      station: {type: string, nullable: false}\n    remote: ${remote}\n  - id: local_notes\n    type: json\n    file: local_notes.json\n    schema:\n      note: {type: string, nullable: false}\nfilters: []\nrelationships: []\nqueries:\n  total: {sql: queries/total.sql, params: []}\nlayout:\n  - {id: total, type: kpi, query: total, label: Total, field: value, x: 1, y: 1, width: 12, height: 1}\n`,
 });
}

test("packaged remote sources compile to local-shaped runtime sources without remote metadata", async () => {
 const { dashboard } = await remoteProject(
  `{uri: s3://example-bucket/inspections.parquet, format: parquet, auth: s3, region: eu-central-1}`,
 );
 const { config, json, remoteSources } = await compileProject(dashboard);
 assert.deepEqual(config.data.sources[0], {
  id: "inspections",
  type: "parquet",
  file: "inspections.parquet",
  schema: { station: { type: "string", nullable: false } },
 });
 assert.deepEqual(remoteSources, [
  {
   id: "inspections",
   uri: "s3://example-bucket/inspections.parquet",
   format: "parquet",
   auth: "s3",
   region: "eu-central-1",
   filename: "inspections.parquet",
  },
 ]);
 assert.equal(json.includes("s3://"), false);
 assert.equal(json.includes("remote"), false);
});

test("remote member names fall back to the sanitized URI basename", async () => {
 const { dashboard } = await remoteProject(
  `{uri: "https://example.com/data/inspections.parquet?x=1", format: parquet, auth: none}`,
 );
 const { config, remoteSources } = await compileProject(dashboard);
 assert.equal(config.data.sources[0].file, "inspections.parquet");
 assert.equal(remoteSources[0].filename, "inspections.parquet");
});

test("live remote sources compile their read metadata into the runtime config", async () => {
 const { dashboard } = await remoteProject(
  `{uri: https://example.com/inspections.parquet, format: parquet, auth: s3, region: eu-central-1, delivery: live}`,
 );
 const { config, remoteSources } = await compileProject(dashboard);
 assert.deepEqual(config.data.sources[0], {
  id: "inspections",
  schema: { station: { type: "string", nullable: false } },
  remote: {
   uri: "https://example.com/inspections.parquet",
   format: "parquet",
   auth: "s3",
   region: "eu-central-1",
  },
 });
 assert.equal(config.data.sources[0].file, undefined);
 assert.equal(remoteSources.length, 0, "live sources must not be materialized at build time");
});

test("invalid or leak-prone remote declarations fail with precise locations", async () => {
 const cases = [
  {
   remote: `{uri: ftp://example.com/a.parquet, format: parquet, auth: none}`,
   match: /dashboard\.yaml:\d+:\d+.*sources\.0\.remote\.uri.*pattern/i,
  },
  {
   remote: `{uri: https://example.com/a.parquet, format: parquet, auth: none, secret: "hunter2"}`,
   match: /dashboard\.yaml:\d+:\d+.*sources\.0\.remote\.secret.*additional property/i,
  },
  {
   remote: `{uri: https://key:hunter2@example.com/a.parquet, format: parquet, auth: none}`,
   match: /dashboard\.yaml:\d+:\d+.*remote uri must not embed credentials/i,
  },
  {
   remote: `{uri: "https://example.com/a.parquet?X-Amz-Credential=key&X-Amz-Signature=sig", format: parquet, auth: none}`,
   match: /dashboard\.yaml:\d+:\d+.*credential or secret-looking query parameters/i,
  },
  {
   remote: `{uri: https://example.com/a.parquet, format: parquet, auth: none, endpoint: "https://user:pass@example.com"}`,
   match: /dashboard\.yaml:\d+:\d+.*remote\.endpoint.*credentials/i,
  },
  {
   yamlOverride: `project: 1\ntitle: Remote dashboard\nsources:\n  - id: inspections\n    type: parquet\n    schema:\n      station: {type: string, nullable: false}\n    remote:\n      uri: https://example.com/a.parquet\n      format: parquet\n      auth: none\nfilters: []\nrelationships: []\nqueries: {}\nlayout: []\n`,
   match: /dashboard\.yaml:\d+:\d+.*sources\.0\.(type|file).*must not be declared together with remote/i,
  },
  {
   yamlOverride: `project: 1\ntitle: Remote dashboard\nsources:\n  - id: inspections\n    schema:\n      station: {type: string, nullable: false}\nfilters: []\nrelationships: []\nqueries: {}\nlayout: []\n`,
   match: /dashboard\.yaml:\d+:\d+.*sources\.0\.(type|file).*required/i,
  },
 ];
 for (const fixture of cases) {
  const { dashboard } = await (fixture.yamlOverride
   ? project({ yaml: fixture.yamlOverride, sql: null })
   : remoteProject(fixture.remote));
  await assert.rejects(() => compileProject(dashboard), fixture.match);
 }
});

/**
 * Live DuckLake sources (spec 2026-10-19-0005 §5, SL-06; ADR 0009 pinned
 * artifact trust; ADR 0010 E2): `remote: {kind: ducklake, uri, table, auth:
 * none, delivery: live}` compiles to a live-only runtime source exposing one
 * explicitly named table of a public HTTPS catalog. The trusted runtime
 * constructs the `ducklake:<uri>` attach string; project declarations carry
 * only the ordinary HTTPS URL and the table name. Non-HTTPS catalogs, S3
 * credentials, missing tables, and file-shaped conflicts fail naming the
 * source, and the pinned DuckLake capability is recorded as the exact
 * owner-approved official artifact — selected only when a dashboard declares
 * a DuckLake source and never influenced by any project-authored location.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileProject } from "../../authoring/compiler.mjs";
import { validateConfig } from "../../contract/config.mjs";
import { DUCKDB_DUCKLAKE_CAPABILITY } from "../../runtime/bootstrap.mjs";
import { renderDashboard, resolveCapabilities } from "../../scripts/build.mjs";

const DUCKLAKE_REMOTE = `{kind: ducklake, uri: "https://raw.githubusercontent.com/marhar/frozen/main/space.ducklake", table: astronauts, auth: none, delivery: live}`;

/** Compile one minimal project with the given remote declaration. */
async function project(remote, querySql = "SELECT count(*) AS value FROM astronauts\n") {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-ducklake-"));
 await mkdir(path.join(dir, "queries"));
 await writeFile(
  path.join(dir, "dashboard.yaml"),
  `project: 1
title: DuckLake dashboard
sources:
  - id: astronauts
    schema:
      name: {type: string, nullable: true}
    remote: ${remote}
filters: []
relationships: []
queries:
  total: {sql: queries/total.sql, params: []}
layout:
  - {id: total, type: kpi, query: total, label: Total, field: value, x: 1, y: 1, width: 12, height: 1}
`,
 );
 await writeFile(path.join(dir, "queries", "total.sql"), querySql);
 return path.join(dir, "dashboard.yaml");
}

test("the approved ducklake declaration compiles live-only to uri and table", async () => {
 const dashboard = await project(DUCKLAKE_REMOTE);
 const { config, json, remoteSources } = await compileProject(dashboard);
 assert.deepEqual(config.data.sources[0].remote, {
  kind: "ducklake",
  uri: "https://raw.githubusercontent.com/marhar/frozen/main/space.ducklake",
  table: "astronauts",
  auth: "none",
 });
 assert.equal(validateConfig(config).ok, true);
 assert.deepEqual(remoteSources, [], "live-only ducklake tables never materialize");
 // The runtime contract admits exactly the approved ducklake shape and
 // nothing wider: a table on a file-shaped remote stays invalid.
 assert.equal(
  validateConfig({
   ...config,
   data: {
    mode: "upload",
    sources: [
     {
      id: "astronauts",
      schema: config.data.sources[0].schema,
      remote: { uri: "https://host.example/a.parquet", format: "parquet", auth: "none", table: "astronauts" },
     },
    ],
   },
  }).ok,
  false,
 );
 // The compiled config carries only the declared identity: no catalog
 // bytes, credentials, or delivery mode travel into the artifact.
 assert.equal(json.includes("space.ducklake"), true);
 for (const material of ["delivery", "secret", "key_id"]) {
  assert.equal(json.includes(material), false, material);
 }
});

test("invalid ducklake declarations fail naming the source", async () => {
 const cases = [
  {
   remote: `{kind: ducklake, uri: "s3://reports/space.ducklake", table: astronauts, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "astronauts".*ducklake uri must be a public https:\/\/ URL/,
  },
  {
   remote: `{kind: ducklake, uri: "https://example.com/space.ducklake", auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "astronauts".*requires "table"/,
  },
  {
   remote: `{kind: ducklake, uri: "https://example.com/space.ducklake", table: astronauts, auth: s3, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "astronauts".*ducklake requires auth: none/,
  },
  {
   remote: `{kind: ducklake, uri: "https://example.com/space.ducklake", table: astronauts, auth: none, format: parquet, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "astronauts".*cannot declare "format"/,
  },
  {
   remote: `{uri: "https://host.example/astronauts.parquet", format: parquet, auth: none, table: astronauts}`,
   match: /dashboard\.yaml:\d+:\d+.*source "astronauts".*table requires remote.kind: ducklake/,
  },
 ];
 for (const { remote, match } of cases) {
  const dashboard = await project(remote);
  await assert.rejects(compileProject(dashboard), match);
 }
});

test("the pinned ducklake capability is selected and recorded exactly", async () => {
 const dashboard = await project(DUCKLAKE_REMOTE);
 const { config } = await compileProject(dashboard);
 assert.deepEqual(
  resolveCapabilities(config).find(({ id }) => id === "ducklake"),
  { id: "ducklake", version: DUCKDB_DUCKLAKE_CAPABILITY.version },
 );
 const without = await project(
  `{uri: "https://example.com/astronauts.parquet", format: parquet, auth: none}`,
 );
 const compiled = await compileProject(without);
 assert.equal(
  resolveCapabilities(compiled.config).some(({ id }) => id === "ducklake"),
  false,
  "no ducklake source, no ducklake capability",
 );
 // The manifest records the exact owner-approved artifact (ADR 0009 G3):
 // only these bytes at this pinned URL/version.
 assert.deepEqual(DUCKDB_DUCKLAKE_CAPABILITY, {
  id: "ducklake",
  version: "1.33.1-dev64.0",
  duckdbVersion: "v1.5.5",
  platform: "wasm_eh",
  url: "https://extensions.duckdb.org/v1.5.5/wasm_eh/ducklake.duckdb_extension.wasm",
  sha256: "154f2504ac3e92de146e5193012ac898ce97f62d5b4701f534176d49aae5594a",
 });
 const rendered = await renderDashboard({ config });
 const recorded = rendered.capabilities.find(({ id }) => id === "ducklake");
 assert.deepEqual(recorded, DUCKDB_DUCKLAKE_CAPABILITY);
});

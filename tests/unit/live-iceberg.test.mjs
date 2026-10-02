/**
 * Live Iceberg metadata-URI sources (spec 2026-09-28-0004 §2.2, LT-01,
 * LT-05, LT-07): `remote: {kind: iceberg, metadataUri}` compiles to a
 * live-only runtime source carrying only the declared non-secret identity,
 * conflicting or file-shaped fields fail naming the source, authored SQL can
 * never invoke `iceberg_scan` (or any reader/extension command), and the
 * trusted Iceberg capability is recorded as the pinned official artifact —
 * selected only when a dashboard declares an Iceberg source and never
 * influenced by any project-authored location.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileProject } from "../../authoring/compiler.mjs";
import { validateConfig } from "../../contract/config.mjs";
import { icebergScope, liveSecretSql } from "../../runtime/sources.mjs";
import { renderDashboard, resolveCapabilities } from "../../scripts/build.mjs";

const ICEBERG_REMOTE = `{kind: iceberg, metadataUri: "s3://reports/orders/metadata/v3.metadata.json", auth: s3, region: eu-central-1, delivery: live}`;
const LEGACY_REMOTE = `{uri: "https://example.com/inspections.parquet", format: parquet, auth: none}`;

/** Compile one minimal project with the given remote declaration. */
async function project(remote, querySql = "SELECT count(*) AS value FROM orders\n") {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-iceberg-"));
 await mkdir(path.join(dir, "queries"));
 await writeFile(
  path.join(dir, "dashboard.yaml"),
  `project: 1
title: Iceberg dashboard
sources:
  - id: orders
    schema:
      station: {type: string, nullable: false}
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

test("an iceberg metadata-uri declaration compiles live-only without inventory", async () => {
 const dashboard = await project(ICEBERG_REMOTE);
 const { config, json, remoteSources } = await compileProject(dashboard);
 assert.deepEqual(config.data.sources[0].remote, {
  kind: "iceberg",
  metadataUri: "s3://reports/orders/metadata/v3.metadata.json",
  auth: "s3",
  region: "eu-central-1",
 });
 assert.equal(validateConfig(config).ok, true);
 assert.deepEqual(remoteSources, [], "live-only iceberg tables never materialize");
 // The compiled config carries only the declared identity: no table
 // metadata inventory, snapshot manifests, data files, or delivery mode
 // (LT-07).
 assert.equal(json.includes("v3.metadata.json"), true);
 for (const inventory of ["snap-", ".avro", "00001.parquet", "delivery"]) {
  assert.equal(json.includes(inventory), false, inventory);
 }
});

test("iceberg identity conflicts and invalid metadata URIs fail naming the source", async () => {
 const cases = [
  {
   remote: `{kind: iceberg, metadataUri: "s3://reports/orders/metadata/v3.metadata.json", uri: "s3://reports/orders/", auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*cannot declare "uri".*"metadataUri" alone/,
  },
  {
   remote: `{kind: iceberg, metadataUri: "s3://reports/orders/metadata/v3.metadata.json", format: parquet, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*cannot declare "format"/,
  },
  {
   remote: `{kind: iceberg, metadataUri: "s3://reports/orders/metadata/v3.metadata.json", selector: {glob: "part-*.parquet"}, auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*cannot declare "selector"/,
  },
  {
   remote: `{kind: iceberg, metadataUri: "s3://reports/orders/metadata/v3.metadata.json", auth: none}`,
   match: /dashboard\.yaml:\d+:\d+.*remote\.delivery.*required property 'delivery'/,
  },
  {
   remote: `{kind: iceberg, metadataUri: "s3://reports/orders/metadata/v3.metadata.json", auth: none, delivery: packaged}`,
   match: /dashboard\.yaml:\d+:\d+.*remote\.delivery.*must be "live"/,
  },
  {
   remote: `{kind: iceberg, metadataUri: "s3://reports/orders/orders.parquet", auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*metadataUri must be an s3:\/\/ URI of a versioned \.metadata\.json document/,
  },
  {
   remote: `{kind: iceberg, metadataUri: "https://example.com/v3.metadata.json", auth: none, delivery: live}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*metadataUri must be an s3:\/\/ URI/,
  },
  {
   remote: `{metadataUri: "s3://reports/orders/metadata/v3.metadata.json", uri: "https://example.com/x.parquet", format: parquet, auth: none}`,
   match: /dashboard\.yaml:\d+:\d+.*source "orders".*metadataUri requires remote\.kind: iceberg/,
  },
 ];
 for (const fixture of cases) {
  const dashboard = await project(fixture.remote);
  await assert.rejects(() => compileProject(dashboard), fixture.match);
 }
});

test("a REST catalog identity stays an unknown field naming source and field", async () => {
 // `catalog` arrives with T4; until then it is an unknown remote field.
 const dashboard = await project(
  `{kind: iceberg, catalog: {endpoint: "https://catalog.example.com"}, auth: none, delivery: live}`,
 );
 await assert.rejects(
  () => compileProject(dashboard),
  /dashboard\.yaml:\d+:\d+.*sources\.0\.remote\.catalog.*additional property/,
 );
});

test("authored SQL cannot invoke iceberg_scan or extension commands", async () => {
 for (const [sql, match] of [
  [
   "SELECT count(*) AS value FROM iceberg_scan('s3://reports/orders/metadata/v3.metadata.json')\n",
   /file readers are not supported/,
  ],
  ["LOAD iceberg\nSELECT count(*) AS value FROM orders\n", /query must be one SELECT statement/],
  ["ATTACH 'x' AS y\nSELECT count(*) AS value FROM orders\n", /query must be one SELECT statement/],
 ]) {
  const dashboard = await project(ICEBERG_REMOTE, sql);
  await assert.rejects(() => compileProject(dashboard), match);
 }
});

test("legacy single-file remote declarations compile unchanged", async () => {
 const dashboard = await project(LEGACY_REMOTE);
 const { config, remoteSources } = await compileProject(dashboard);
 // Packaged default delivery keeps the local-shaped runtime source.
 assert.equal(config.data.sources[0].remote, undefined);
 assert.deepEqual(
  { type: config.data.sources[0].type, file: config.data.sources[0].file },
  { type: "parquet", file: "inspections.parquet" },
 );
 assert.deepEqual(remoteSources, [
  {
   id: "orders",
   uri: "https://example.com/inspections.parquet",
   format: "parquet",
   auth: "none",
   filename: "inspections.parquet",
  },
 ]);
});

test("the runtime contract accepts the iceberg remote shape and nothing wider", () => {
 const base = {
  contract: 2,
  app: "grid",
  title: "Iceberg runtime",
  data: {
   mode: "upload",
   sources: [
    {
     id: "orders",
     schema: { station: { type: "string", nullable: false } },
     remote: {
      kind: "iceberg",
      metadataUri: "s3://reports/orders/metadata/v3.metadata.json",
      auth: "s3",
     },
    },
   ],
  },
  filters: [],
  queries: { total: { sql: "SELECT count(*) AS value FROM orders", params: [] } },
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
  theme: "neutral",
 };
 assert.equal(validateConfig(base).ok, true);
 for (const extra of [
  { catalog: { endpoint: "https://catalog.example.com" } },
  { delivery: "live" },
  { uri: "s3://reports/orders/" },
  { selector: { glob: "part-*.parquet" } },
  { extensionUrl: "https://evil.example.com/iceberg.wasm" },
  { extensionRepository: "https://evil.example.com" },
 ]) {
  const config = structuredClone(base);
  Object.assign(config.data.sources[0].remote, extra);
  assert.equal(validateConfig(config).ok, false, JSON.stringify(extra));
 }
});

test("iceberg credentials scope to the table location and quote SQL literals", () => {
 const sql = liveSecretSql(
  "orders",
  { keyId: "k'y", secret: "s\"x" },
  {
   kind: "iceberg",
   metadataUri: "s3://reports/orders/metadata/v3.metadata.json",
   auth: "s3",
   endpoint: "127.0.0.1:9443",
  },
 );
 assert.match(sql, /SCOPE 's3:\/\/reports\/orders\/'/);
 assert.match(sql, /ENDPOINT '127\.0\.0\.1:9443'/);
 assert.match(sql, /URL_STYLE 'path'/);
 assert.match(sql, /KEY_ID 'k''y'/);
 assert.match(sql, /SECRET 's"x'/);
 // Iceberg convention: metadata/ and data/ live under the table location.
 assert.equal(
  icebergScope("s3://reports/orders/metadata/v3.metadata.json"),
  "s3://reports/orders/",
 );
 // A flat layout scopes to the document's own directory.
 assert.equal(
  icebergScope("s3://reports/orders/v3.metadata.json"),
  "s3://reports/orders/",
 );
});

test("the trusted iceberg capability is selected by iceberg sources and pinned", async () => {
 const plain = {
  contract: 2,
  app: "grid",
  title: "Plain",
  data: {
   mode: "upload",
   sources: [
    {
     id: "orders",
     schema: { station: { type: "string", nullable: false } },
     remote: { uri: "s3://reports/o.parquet", format: "parquet", auth: "none" },
    },
   ],
  },
  filters: [],
  queries: { total: { sql: "SELECT count(*) AS value FROM orders", params: [] } },
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
  theme: "neutral",
 };
 const icebergConfig = structuredClone(plain);
 icebergConfig.data.sources[0].remote = {
  kind: "iceberg",
  metadataUri: "s3://reports/orders/metadata/v3.metadata.json",
  auth: "none",
 };
 assert.equal(
  resolveCapabilities(plain).some(({ id }) => id === "iceberg"),
  false,
 );
 const capabilities = resolveCapabilities(icebergConfig).find(
  ({ id }) => id === "iceberg",
 );
 assert.ok(capabilities, "iceberg capability selected");
 const { capabilities: manifest } = await renderDashboard({ config: icebergConfig });
 const iceberg = manifest.find(({ id }) => id === "iceberg");
 assert.ok(iceberg, "manifest records the iceberg capability");
 assert.equal(
  iceberg.url,
  "https://extensions.duckdb.org/v1.5.5/wasm_eh/iceberg.duckdb_extension.wasm",
 );
 assert.equal(iceberg.duckdbVersion, "v1.5.5");
 assert.equal(iceberg.platform, "wasm_eh");
 // No project-authored extension location exists anywhere in the artifact.
 const { html } = await renderDashboard({ config: icebergConfig });
 assert.equal(html.includes("custom_extension_repository"), false);
 assert.equal(html.includes("evil.example.com"), false);
});

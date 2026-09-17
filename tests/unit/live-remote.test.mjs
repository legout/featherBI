import assert from "node:assert/strict";
import test from "node:test";
import { validateConfig } from "../../contract/config.mjs";
import { promptLiveCredentials } from "../../runtime/viewer.mjs";
import {
 classifyLiveError,
 liveSecretName,
 liveSecretSql,
} from "../../runtime/sources.mjs";

const LIVE_SOURCE = {
 id: "bucket",
 schema: { station: { type: "string", nullable: false } },
 remote: {
  uri: "s3://example-bucket/inspections.parquet",
  format: "parquet",
  auth: "s3",
  region: "eu-central-1",
 },
};

const BASE_CONFIG = {
 contract: 2,
 app: "grid",
 title: "Live dashboard",
 data: { mode: "upload", sources: [LIVE_SOURCE] },
 filters: [],
 queries: {
  total: { sql: "SELECT count(*) AS value FROM bucket", params: [] },
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
};

test("a live remote runtime source validates with its read metadata", () => {
 const validation = validateConfig(BASE_CONFIG);
 assert.equal(validation.ok, true);
});

test("runtime remote metadata stays minimal and consistent", () => {
 for (const extra of [
  { filename: "x.parquet" },
  { delivery: "live" },
  { secret: "hunter2" },
 ]) {
  const config = structuredClone(BASE_CONFIG);
  config.data.sources[0] = {
   ...config.data.sources[0],
   remote: { ...config.data.sources[0].remote, ...extra },
  };
  assert.equal(validateConfig(config).ok, false, JSON.stringify(extra));
 }
 const withFile = structuredClone(BASE_CONFIG);
 withFile.data.sources[0] = {
  ...withFile.data.sources[0],
  file: "bucket.parquet",
 };
 assert.equal(validateConfig(withFile).ok, false);
});

test("runtime rejects credential-bearing remote declarations", () => {
 for (const remote of [
  { ...LIVE_SOURCE.remote, uri: `${LIVE_SOURCE.remote.uri}?X-Amz-Credential=key&X-Amz-Signature=sig` },
  { ...LIVE_SOURCE.remote, endpoint: "https://user:pass@example.com" },
 ]) {
  const config = structuredClone(BASE_CONFIG);
  config.data.sources[0] = { ...config.data.sources[0], remote };
  assert.equal(validateConfig(config).ok, false);
 }
});

test("private credential submission resolves before dialog close cancellation", async () => {
 const previousDocument = globalThis.document;
 const elements = [];
 class FakeElement {
  constructor(tag) {
   this.tagName = tag;
   this.children = [];
   this.listeners = {};
   this.dataset = {};
   this.value = "";
   elements.push(this);
  }
  append(...children) { this.children.push(...children); }
  prepend(child) { this.children.unshift(child); }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  setAttribute() {}
  showModal() {}
  close() { this.listeners.close?.(); }
  remove() {}
 }
 try {
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  const body = new FakeElement("body");
  const promise = promptLiveCredentials(
   { body },
   { id: "bucket" },
   null,
  );
  const inputs = elements.filter(({ tagName }) => tagName === "input");
  inputs[0].value = "key";
  inputs[1].value = "secret";
  const form = elements.find(({ tagName }) => tagName === "form");
  form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(await promise, { keyId: "key", secret: "secret", sessionToken: undefined });
 } finally {
  globalThis.document = previousDocument;
 }
});

test("private live secrets build temporary config-provider SQL", () => {
 const sql = liveSecretSql(
  "bucket",
  { keyId: "AKIA", secret: "s3cret", sessionToken: "tok" },
  LIVE_SOURCE.remote,
 );
 assert.match(sql, /CREATE OR REPLACE TEMPORARY SECRET "featherbi_live_bucket"/);
 assert.match(sql, /PROVIDER config/);
 assert.match(sql, /KEY_ID 'AKIA'/);
 assert.match(sql, /SECRET 's3cret'/);
 assert.match(sql, /SESSION_TOKEN 'tok'/);
 assert.match(sql, /REGION 'eu-central-1'/);
 assert.equal(sql.includes("ENDPOINT"), false);
 assert.equal(
  liveSecretName("bucket"),
  "featherbi_live_bucket",
 );
});

test("endpoint-bearing remotes use path-style and quote SQL literals", () => {
 const sql = liveSecretSql(
  "bucket",
  { keyId: "k'x", secret: "s''y" },
  { ...LIVE_SOURCE.remote, endpoint: "127.0.0.1:9000" },
 );
 assert.match(sql, /ENDPOINT '127\.0\.0\.1:9000'/);
 assert.match(sql, /URL_STYLE 'path'/);
 assert.match(sql, /KEY_ID 'k''x'/);
 assert.match(sql, /SECRET 's''''y'/);
});

test("live read failures classify into credential, network, and other", () => {
 assert.equal(
  classifyLiveError(new Error("IO Error: HTTP Status 403")),
  "credentials",
 );
 assert.equal(
  classifyLiveError(new Error("InvalidAccessKeyId: nope")),
  "credentials",
 );
 assert.equal(
  classifyLiveError(new Error("ExpiredToken: token has expired")),
  "credentials",
 );
 assert.equal(
  classifyLiveError(new Error("TypeError: Failed to fetch")),
  "network",
 );
 assert.equal(
  classifyLiveError(new Error("getaddrinfo ENOTFOUND example.com")),
  "network",
 );
 assert.equal(
  classifyLiveError(new Error("Parser Error: nope")),
  "other",
 );
});

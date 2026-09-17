import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { assertSafeZipMembers, buildArtifact } from "../../packager/build.mjs";

const execFileAsync = promisify(execFile);

test("packaging produces one deterministic external-data ZIP", async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-packager-"));
 const sourcePath = path.join(dir, "ap.json");
 const configPath = path.join(dir, "config.json");
 const config = {
  contract: 1,
  app: "grid",
  title: "</script><script>globalThis.__featherbiInjected = true</script>",
  data: {
   mode: "upload",
   sources: [
    {
     id: "ap",
     type: "json",
     file: "ap.json",
     schema: { station: { type: "string", nullable: false } },
    },
   ],
  },
  filters: [],
  queries: {
   summary: { sql: "SELECT count(*) AS records FROM ap", params: [] },
  },
  layout: [
   {
    id: "records",
    type: "kpi",
    query: "summary",
    field: "records",
    label: "Records",
   },
  ],
 };
 const sourcePayload = '[{"station":"SJ"}]';
 await writeFile(sourcePath, sourcePayload);
 await writeFile(configPath, JSON.stringify(config));

 assert.throws(() =>
  assertSafeZipMembers(["dashboard.html", "../escape.json"]),
 );
 assert.throws(() => assertSafeZipMembers(["dashboard.html", "/escape.json"]));
 assert.throws(() =>
  assertSafeZipMembers(["dashboard.html", "data\\escape.json"]),
 );
 assert.throws(() =>
  assertSafeZipMembers(["dashboard.html", "dashboard.html"]),
 );
 assert.throws(() => assertSafeZipMembers(["ap.json", "AP.json"]));

 const zip = path.join(dir, "dashboard.zip");
 const zipCopy = path.join(dir, "dashboard-copy.zip");
 const options = {
  configPath,
  sources: { ap: sourcePath },
 };
 await buildArtifact({ ...options, outPath: zip });
 await buildArtifact({ ...options, outPath: zipCopy });
 assert.deepEqual(await readFile(zip), await readFile(zipCopy));

 const extracted = path.join(dir, "extracted");
 await execFileAsync("uv", [
  "run",
  "python",
  "-m",
  "zipfile",
  "-e",
  zip,
  extracted,
 ]);
 const html = await readFile(path.join(extracted, "dashboard.html"), "utf8");
 assert.doesNotMatch(html, /<\/script><script>globalThis\.__featherbiInjected/);
 assert.ok(!html.includes(sourcePayload), "HTML must not contain source bytes");
 assert.ok(
  !html.includes(sourcePath),
  "HTML must not contain local source paths",
 );
 assert.deepEqual(
  await readFile(path.join(extracted, "ap.json")),
  Buffer.from(sourcePayload),
 );

 const original = await readFile(zip);
 await assert.rejects(
  () => buildArtifact({ ...options, outPath: zip }),
  /overwrite/i,
 );
 assert.deepEqual(await readFile(zip), original);
 const source = await readFile(sourcePath);
 await assert.rejects(
  () => buildArtifact({ ...options, outPath: sourcePath, overwrite: true }),
  /must not replace/i,
 );
 assert.deepEqual(await readFile(sourcePath), source);

 await writeFile(configPath, JSON.stringify({ ...config, contract: 2 }));
 const v2Zip = path.join(dir, "dashboard-v2.zip");
 await buildArtifact({ ...options, outPath: v2Zip });
 assert.ok((await readFile(v2Zip)).length > 0);

 await writeFile(configPath, JSON.stringify({ ...config, contract: 3 }));
 await assert.rejects(
  () => buildArtifact({ ...options, outPath: zip, overwrite: true }),
  /invalid dashboard config/i,
 );
 assert.deepEqual(await readFile(zip), original);
 assert.equal(
  (await readdir(dir)).some((name) => name.endsWith(".tmp")),
  false,
 );
});

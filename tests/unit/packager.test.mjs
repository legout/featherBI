import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
 assertSafeZipMembers,
 buildArtifact,
} from "../../packager/build.mjs";

test("packaging keeps members, scripts, and output publication safe", async () => {
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
 await writeFile(sourcePath, '[{"station":"SJ"}]');
 await writeFile(configPath, JSON.stringify(config));

 assert.throws(() => assertSafeZipMembers(["dashboard.html", "../escape.json"]));
 assert.throws(() => assertSafeZipMembers(["dashboard.html", "/escape.json"]));
 assert.throws(() => assertSafeZipMembers(["dashboard.html", "data\\escape.json"]));
 assert.throws(() => assertSafeZipMembers(["dashboard.html", "dashboard.html"]));
 assert.throws(() => assertSafeZipMembers(["ap.json", "AP.json"]));

 const embedded = path.join(dir, "dashboard.html");
 const embeddedCopy = path.join(dir, "dashboard-copy.html");
 const options = {
  configPath,
  sources: { ap: sourcePath },
  mode: "embedded",
 };
 await buildArtifact({ ...options, outPath: embedded });
 await buildArtifact({ ...options, outPath: embeddedCopy });
 const html = await readFile(embedded);
 assert.deepEqual(html, await readFile(embeddedCopy));
 assert.doesNotMatch(
  html.toString("utf8"),
  /<\/script><script>globalThis\.__featherbiInjected/,
 );

 const zip = path.join(dir, "dashboard.zip");
 const zipCopy = path.join(dir, "dashboard-copy.zip");
 await buildArtifact({ ...options, mode: "zip", outPath: zip });
 await buildArtifact({ ...options, mode: "zip", outPath: zipCopy });
 assert.deepEqual(await readFile(zip), await readFile(zipCopy));

 const original = await readFile(embedded);
 await assert.rejects(() => buildArtifact({ ...options, outPath: embedded }), /overwrite/i);
 assert.deepEqual(await readFile(embedded), original);
 const source = await readFile(sourcePath);
 await assert.rejects(
  () => buildArtifact({ ...options, outPath: sourcePath, overwrite: true }),
  /must not replace/i,
 );
 assert.deepEqual(await readFile(sourcePath), source);

 await writeFile(configPath, JSON.stringify({ ...config, contract: 2 }));
 await assert.rejects(
  () => buildArtifact({ ...options, outPath: embedded, overwrite: true }),
  /invalid dashboard config/i,
 );
 assert.deepEqual(await readFile(embedded), original);
 assert.equal((await readdir(dir)).some((name) => name.endsWith(".tmp")), false);
});

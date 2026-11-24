// Release tooling: patches the pinned Perspective charts plugin so Explore works on file:// (ADR 0001 §6).
// On a file: page a blob: URL has the opaque origin "null", so a worker started from it, or a module it imports, fails to load.
// Both patches use a data: URL there instead; on http(s) the bundle behaves as published.
// Usage: node tools/patch-perspective.mjs [--input <bundle.js>] [--output <patched.js>]
// Without --input it downloads the bundle pinned in vendor.lock.json and checks its integrity.
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ON_FILE = 'location.protocol==="file:"';

// Each `find` must occur exactly once in the bundle; a Perspective upgrade that moves one fails the build.
export const ANCHORS = [
  {
    name: "renderer-worker",
    // The plugin starts its WebGL renderer worker from a blob: URL of its inlined worker source `Ie`.
    find: 'let r=new Blob([Ie],{type:"application/javascript"});return O=URL.createObjectURL(r),O',
    replace: `return O=${ON_FILE}?"data:text/javascript,"+encodeURIComponent(Ie):URL.createObjectURL(new Blob([Ie],{type:"application/javascript"})),O`,
  },
  {
    name: "client-worker-url",
    // The renderer worker import()s the viewer's client glue, which the viewer publishes as a blob: URL.
    find: "a=l.get_worker_url()",
    replace: `a=await(async u=>${ON_FILE}&&String(u).startsWith("blob:")?"data:text/javascript,"+encodeURIComponent(await(await fetch(u)).text()):u)(l.get_worker_url())`,
  },
];

export function patch(source) {
  let out = source;
  for (const anchor of ANCHORS) {
    const count = out.split(anchor.find).length - 1;
    if (count !== 1) throw new Error(`anchor "${anchor.name}" found ${count} times, expected once; the Perspective bundle changed`);
    out = out.replace(anchor.find, () => anchor.replace);
  }
  return out;
}

async function pinned() {
  const lock = JSON.parse(fs.readFileSync(new URL("../skill/featherbi/assets/vendor.lock.json", import.meta.url), "utf8")).perspective.charts;
  const response = await fetch(lock.url);
  if (!response.ok) throw new Error(`${lock.url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const integrity = `sha384-${crypto.createHash("sha384").update(bytes).digest("base64")}`;
  if (integrity !== lock.integrity) throw new Error(`${lock.url}: integrity ${integrity} does not match vendor.lock.json`);
  return bytes.toString("utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { input: { type: "string" }, output: { type: "string" } } });
  const output = values.output ?? fileURLToPath(new URL("../skill/featherbi/assets/perspective-charts.patched.js", import.meta.url));
  try {
    const source = values.input ? fs.readFileSync(values.input, "utf8") : await pinned();
    fs.writeFileSync(output, patch(source)); // only reached when every anchor matched
    console.log(`wrote ${output}`);
  } catch (error) {
    console.error(`patch-perspective: ${error.message}`);
    process.exit(1);
  }
}

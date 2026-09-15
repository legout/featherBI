import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { downloadZip } from "client-zip";
import { renderDashboard } from "../scripts/build.mjs";
import { preflightBuild } from "./preflight.mjs";

const ZIP_MTIME = new Date("1980-01-01T00:00:00.000Z");

/** Build and atomically publish one embedded HTML or ZIP artifact. */
export async function buildArtifact({
 configPath,
 sources,
 mode,
 outPath,
 overwrite = false,
}) {
 if (mode !== "embedded" && mode !== "zip") {
  throw new Error(`unsupported artifact mode ${JSON.stringify(mode)}`);
 }
 const { config, inputs } = await preflightBuild({ configPath, sources });
 const resolvedOut = path.resolve(outPath);
 if (
  path.resolve(configPath) === resolvedOut ||
  inputs.some((input) => input.path === resolvedOut)
 ) {
  throw new Error("output must not replace the config or a source file");
 }
 // ponytail: buffer complete artifacts for atomic publication; stream to the sibling temp file if measured authoring memory becomes the bottleneck.
 const bytesBySource = new Map();
 for (const input of inputs) {
  bytesBySource.set(input.source.id, await readFile(input.path));
 }

 let artifact;
 let metadata;
 if (mode === "embedded") {
  const embedded = structuredClone(config);
  embedded.data.mode = "embedded";
  for (const source of embedded.data.sources) {
   source.content = {
    encoding: "base64",
    value: bytesBySource.get(source.id).toString("base64"),
   };
  }
  const rendered = await renderDashboard({ config: embedded });
  artifact = Buffer.from(rendered.html, "utf8");
  metadata = rendered;
 } else {
  const rendered = await renderDashboard({ config });
  const members = ["dashboard.html", ...config.data.sources.map(({ file }) => file)];
  assertSafeZipMembers(members);
  const entries = [
   { name: "dashboard.html", input: rendered.html, lastModified: ZIP_MTIME },
   ...config.data.sources.map((source) => ({
    name: source.file,
    input: bytesBySource.get(source.id),
    lastModified: ZIP_MTIME,
   })),
  ];
  artifact = Buffer.from(await downloadZip(entries).arrayBuffer());
  metadata = rendered;
 }

 await publishFile(resolvedOut, artifact, overwrite);
 return {
  mode,
  outPath: resolvedOut,
  artifactSha256: createHash("sha256").update(artifact).digest("hex"),
  bytes: artifact.length,
  duckdbWasm: metadata.duckdbWasm,
  echarts: metadata.echarts,
 };
}

/** Reject unsafe, absolute, traversing, empty, backslash, control, and duplicate members. */
export function assertSafeZipMembers(names) {
 const seen = new Set();
 for (const name of names) {
  if (
   typeof name !== "string" ||
   name === "" ||
   name.startsWith("/") ||
   /^[A-Za-z]:/.test(name) ||
   name.includes("\\") ||
   hasControlCharacter(name) ||
   name !== path.posix.normalize(name) ||
   name.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
   throw new Error(`unsafe ZIP member ${JSON.stringify(name)}`);
  }
  // ponytail: ASCII toLowerCase, matching schema validation; Unicode-only case pairs on case-insensitive filesystems are out of scope.
  const key = name.toLowerCase();
  if (seen.has(key)) {
   throw new Error(`duplicate ZIP member ${JSON.stringify(name)}`);
  }
  seen.add(key);
 }
}

function hasControlCharacter(value) {
 return [...value].some((character) => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
 });
}

async function publishFile(outPath, contents, overwrite) {
 await mkdir(path.dirname(outPath), { recursive: true });
 const tempPath = path.join(
  path.dirname(outPath),
  `.${path.basename(outPath)}.${process.pid}-${randomUUID()}.tmp`,
 );
 try {
  await writeFile(tempPath, contents, { flag: "wx" });
  if (overwrite) {
   await rename(tempPath, outPath);
  } else {
   try {
    await link(tempPath, outPath);
   } catch (error) {
    if (error.code === "EEXIST") {
     throw new Error(`output exists; pass --overwrite to replace ${JSON.stringify(outPath)}`);
    }
    throw error;
   }
   await rm(tempPath);
  }
 } catch (error) {
  await rm(tempPath, { force: true });
  throw error;
 }
}

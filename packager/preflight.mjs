import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { validateConfig } from "../contract/config.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(
 path.dirname(fileURLToPath(import.meta.url)),
 "..",
);
const REMOTE_SOURCE_ID = /^[a-z][a-z0-9_]*$/;
const REMOTE_FORMATS = new Set(["csv", "parquet", "json"]);
const REMOTE_AUTH = new Set(["none", "s3"]);

/** Load and validate a dashboard config with the shared browser validator. */
export async function loadConfig(configPath) {
 const resolved = path.resolve(configPath);
 let config;
 try {
  config = JSON.parse(await readFile(resolved, "utf8"));
 } catch (error) {
  throw new Error(`cannot read dashboard config ${JSON.stringify(configPath)}: ${error.message}`, {
   cause: error,
  });
 }
 const validation = validateConfig(config);
 if (!validation.ok) {
  throw new Error(
   `invalid dashboard config: ${validation.issues
    .map((issue) => `${issue.path || "config"}: ${issue.message}`)
    .join("; ")}`,
  );
 }
 return config;
}

/** Load the compiler-written remote source declarations next to one config. */
async function loadRemoteSources(configPath) {
 const remotePath = path.join(
  path.dirname(path.resolve(configPath)),
  "remote-sources.json",
 );
 let raw;
 try {
  raw = await readFile(remotePath, "utf8");
 } catch (error) {
  if (error?.code === "ENOENT") return [];
  throw new Error(
   `cannot read remote sources ${JSON.stringify(remotePath)}: ${error.message}`,
   { cause: error },
  );
 }
 let parsed;
 try {
  parsed = JSON.parse(raw);
 } catch (error) {
  throw new Error(
   `invalid remote sources ${JSON.stringify(remotePath)}: ${error.message}`,
   { cause: error },
  );
 }
 if (!Array.isArray(parsed)) {
  throw new Error(`invalid remote sources ${JSON.stringify(remotePath)}: must be an array`);
 }
 return parsed.map((entry, index) => {
  const invalid = (message) =>
   new Error(
    `invalid remote sources ${JSON.stringify(remotePath)}: entry ${index} ${message}`,
   );
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
   throw invalid("must be an object");
  }
  if (typeof entry.id !== "string" || !REMOTE_SOURCE_ID.test(entry.id)) {
   throw invalid(`has invalid id ${JSON.stringify(entry.id)}`);
  }
  // Author-local build state mirrors the authoring scheme rules (s3/https);
  // plain http stays legal here so localhost fixtures can substitute real
  // URIs without weakening the dashboard.yaml schema.
  if (typeof entry.uri !== "string" || !/^(?:s3|https?):\/\//.test(entry.uri)) {
   throw invalid(`has invalid uri for source ${JSON.stringify(entry.id)}`);
  }
  if (!REMOTE_FORMATS.has(entry.format)) {
   throw invalid(`has invalid format for source ${JSON.stringify(entry.id)}`);
  }
  if (!REMOTE_AUTH.has(entry.auth)) {
   throw invalid(`has invalid auth for source ${JSON.stringify(entry.id)}`);
  }
  for (const key of ["region", "endpoint"]) {
   if (entry[key] !== undefined && (typeof entry[key] !== "string" || entry[key] === "")) {
    throw invalid(`has invalid ${key}`);
   }
  }
  return {
   id: entry.id,
   uri: entry.uri,
   format: entry.format,
   auth: entry.auth,
   ...(entry.region ? { region: entry.region } : {}),
   ...(entry.endpoint ? { endpoint: entry.endpoint } : {}),
  };
 });
}

/** Fetch one remote source to a local file through the uv-pinned script. */
async function materializeRemote(remote, scratchDir) {
 const output = path.join(scratchDir, `${remote.id}.${remote.format}`);
 try {
  await execFileAsync(
   "uv",
   [
    "run",
    "--script",
    path.join(rootDir, "skill", "featherbi", "scripts", "materialize.py"),
    remote.uri,
    "--source-id",
    remote.id,
    "--format",
    remote.format,
    "--auth",
    remote.auth,
    ...(remote.region ? ["--region", remote.region] : []),
    ...(remote.endpoint ? ["--endpoint", remote.endpoint] : []),
    "--output",
    output,
   ],
   { maxBuffer: 100_000 },
  );
 } catch (error) {
  const cause = error instanceof Error ? error.message : String(error);
  throw new Error(`cannot materialize source ${JSON.stringify(remote.id)}: ${cause}`, {
   cause: error,
  });
 }
 return output;
}

/** Validate an upload-mode authoring config and its explicit source assignments. */
export async function preflightBuild({ configPath, sources }) {
 const config = await loadConfig(configPath);
 if (config.data.mode !== "upload") {
  throw new Error("artifact builds require an upload-mode authoring config");
 }
 const assigned = new Map(Object.entries(sources ?? {}));
 const declared = new Set(config.data.sources.map(({ id }) => id));
 for (const id of assigned.keys()) {
  if (!declared.has(id)) {
   throw new Error(`source assignment references unknown source ${JSON.stringify(id)}`);
  }
 }
 const remotes = await loadRemoteSources(configPath);
 const remoteById = new Map(remotes.map((remote) => [remote.id, remote]));
 for (const remote of remotes) {
  const source = config.data.sources.find(({ id }) => id === remote.id);
  if (source?.remote) {
   throw new Error(
    `stale remote source declaration for ${JSON.stringify(remote.id)}: the source is declared live; recompile the project`,
   );
  }
 }
 for (const id of assigned.keys()) {
  if (remoteById.has(id)) {
   throw new Error(
    `source ${JSON.stringify(id)} is a remote source materialized at build time; remove its --source assignment`,
   );
  }
 }
 const scratchDir = remotes.length
  ? await mkdtemp(path.join(os.tmpdir(), "featherbi-remote-"))
  : null;
 const cleanup = scratchDir
  ? () => rm(scratchDir, { recursive: true, force: true })
  : null;
 const inputs = [];
 try {
  for (const source of config.data.sources) {
   if (source.remote) {
    // Live sources read their URI in the recipient's browser; they never
    // become ZIP members and need no assignment or materialization.
    continue;
   }
   const remote = remoteById.get(source.id);
   if (remote) {
    inputs.push({ source, path: await materializeRemote(remote, scratchDir) });
    continue;
   }
   const sourcePath = assigned.get(source.id);
   if (!sourcePath) {
    throw new Error(`missing source assignment for ${JSON.stringify(source.id)}`);
   }
   const resolved = path.resolve(sourcePath);
   let info;
   try {
    info = await stat(resolved);
   } catch (error) {
    throw new Error(`cannot read source ${JSON.stringify(source.id)}: ${error.message}`, {
     cause: error,
    });
   }
   if (!info.isFile()) {
    throw new Error(`source ${JSON.stringify(source.id)} must reference a file`);
   }
   inputs.push({ source, path: resolved });
  }
 } catch (error) {
  await cleanup?.();
  throw error;
 }
 return { config, inputs, cleanup };
}

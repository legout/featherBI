import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { validateConfig } from "../contract/config.mjs";

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
 const inputs = [];
 for (const source of config.data.sources) {
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
 return { config, inputs };
}

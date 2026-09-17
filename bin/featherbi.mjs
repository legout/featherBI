#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
 path.dirname(fileURLToPath(import.meta.url)),
 "..",
);

try {
 const [command, ...args] = process.argv.slice(2);
 if (!command || command === "--help" || command === "-h") {
  printHelp();
 } else if (command === "profile") {
  const options = parseSimpleArgs(args, new Set(["--include-values"]));
  const profileArgs = [
   "run",
   "--script",
   path.join(rootDir, "skill", "featherbi", "scripts", "profile.py"),
   required(options.input, "--input"),
   "--source-id",
   required(options.sourceId, "--source-id"),
   "--format",
   required(options.format, "--format"),
  ];
  if (options.auth) {
   if (!["none", "s3"].includes(options.auth)) {
    throw new Error(`--auth must be none or s3, found ${JSON.stringify(options.auth)}`);
   }
   profileArgs.push("--auth", options.auth);
  }
  if (options.region) profileArgs.push("--region", options.region);
  if (options.endpoint) profileArgs.push("--endpoint", options.endpoint);
  if (options.includeValues) profileArgs.push("--include-values");
  if (options.output) {
   await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
   profileArgs.push("--output", options.output);
  }
  await run("uv", profileArgs);
 } else if (command === "compile") {
  const options = parseSimpleArgs(args);
  await ensureValidator();
  const projectPath = required(options.project, "--project");
  const { compileProject } = await import("../authoring/compiler.mjs");
  const result = await compileProject(projectPath);
  const output = path.resolve(
   options.output ??
    path.join(path.dirname(projectPath), ".featherbi", "dashboard.config.json"),
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, result.json, "utf8");
  const remotePath = path.join(path.dirname(output), "remote-sources.json");
  if (result.remoteSources.length > 0) {
   await writeFile(
    remotePath,
    `${JSON.stringify(result.remoteSources, null, 2)}\n`,
    "utf8",
   );
   console.log(`wrote ${remotePath}`);
  } else {
   await rm(remotePath, { force: true });
  }
  console.log(`wrote ${output}`);
 } else if (command === "validate") {
  const options = parseArgs(args, { sources: false, build: false });
  await ensureValidator();
  const { loadConfig } = await import("../packager/preflight.mjs");
  await loadConfig(required(options.config, "--config"));
  console.log(`valid ${path.resolve(options.config)}`);
 } else if (command === "build") {
  const options = parseArgs(args, { sources: true, build: true });
  await ensureValidator();
  const { buildArtifact } = await import("../packager/build.mjs");
  const result = await buildArtifact({
   configPath: required(options.config, "--config"),
   sources: options.sources,
   outPath: required(options.output, "--output"),
   overwrite: options.overwrite,
  });
  console.log(
   `wrote ${result.outPath} (${result.bytes} bytes, sha256 ${result.artifactSha256})`,
  );
 } else if (command === "setup") {
  const { runSetup } = await import("../scripts/setup.mjs");
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
   input: process.stdin,
   output: process.stderr,
  });
  try {
   const result = await runSetup(args, {
    cwd: process.cwd(),
    prompt: (question) => rl.question(question),
   });
   process.exitCode = result.exitCode;
  } finally {
   rl.close();
  }
 } else {
  throw new Error(
   `unknown command ${JSON.stringify(command)}; run featherbi --help`,
  );
 }
} catch (error) {
 console.error(error instanceof Error ? error.message : String(error));
 process.exitCode = 1;
}

function parseArgs(args, { sources, build }) {
 const options = { sources: {}, overwrite: false };
 for (let index = 0; index < args.length; index += 1) {
  const flag = args[index];
  if (flag === "--overwrite" && build) {
   options.overwrite = true;
   continue;
  }
  if (flag === "--source" && sources) {
   const assignment = nextValue(args, ++index, flag);
   const split = assignment.indexOf("=");
   if (split < 1 || split === assignment.length - 1) {
    throw new Error(
     `--source must be SOURCE_ID=LOCAL_FILE, found ${JSON.stringify(assignment)}`,
    );
   }
   const id = assignment.slice(0, split);
   if (Object.hasOwn(options.sources, id)) {
    throw new Error(`duplicate --source assignment for ${JSON.stringify(id)}`);
   }
   options.sources[id] = assignment.slice(split + 1);
   continue;
  }
  const key = { "--config": "config", "--output": "output" }[flag];
  if (!key || (!build && key !== "config")) {
   throw new Error(`unknown option ${JSON.stringify(flag)}`);
  }
  options[key] = nextValue(args, ++index, flag);
 }
 return options;
}

function parseSimpleArgs(args, booleans = new Set()) {
 const keys = {
  "--input": "input",
  "--source-id": "sourceId",
  "--format": "format",
  "--auth": "auth",
  "--region": "region",
  "--endpoint": "endpoint",
  "--project": "project",
  "--output": "output",
  "--include-values": "includeValues",
 };
 const options = {};
 for (let index = 0; index < args.length; index += 1) {
  const flag = args[index];
  const key = keys[flag];
  if (!key) throw new Error(`unknown option ${JSON.stringify(flag)}`);
  if (booleans.has(flag)) options[key] = true;
  else options[key] = nextValue(args, ++index, flag);
 }
 return options;
}

function nextValue(args, index, flag) {
 if (index >= args.length) throw new Error(`${flag} requires a value`);
 return args[index];
}

function required(value, flag) {
 if (!value) throw new Error(`missing required ${flag}`);
 return value;
}

async function run(command, args) {
 const child = spawn(command, args, { stdio: "inherit" });
 const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
 });
 if (code !== 0) throw new Error(`${command} exited with status ${code}`);
}

async function ensureValidator() {
 try {
  await access(path.join(rootDir, ".generated", "validate-config-v2.mjs"));
 } catch {
  await import("../scripts/build-contract.mjs");
 }
}

function printHelp() {
 console.log(`featherbi setup [--yes|--no] [--agent ID]
featherbi profile --input FILE|URI --source-id ID --format csv|json|ndjson|parquet [--auth none|s3] [--region REGION] [--endpoint ENDPOINT] [--output FILE] [--include-values]
featherbi compile --project DASHBOARD.yaml [--output .featherbi/dashboard.config.json]
featherbi validate --config CONFIG
featherbi build --config CONFIG --source ID=FILE [--source ID=FILE ...] --output FILE [--overwrite]

setup checks Node, uv, and desktop Chrome, then offers the official DuckDB agent skills install. Profiles, compiles, and builds local artifacts only; it never publishes or uploads dashboard data.`);
}

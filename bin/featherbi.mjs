#!/usr/bin/env node

import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
 const [command, ...args] = process.argv.slice(2);
 if (!command || command === "--help" || command === "-h") {
  printHelp();
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
   mode: required(options.mode, "--mode"),
   outPath: required(options.output, "--output"),
   overwrite: options.overwrite,
  });
  console.log(
   `wrote ${result.outPath} (${result.mode}, ${result.bytes} bytes, sha256 ${result.artifactSha256})`,
  );
 } else {
  throw new Error(`unknown command ${JSON.stringify(command)}; run featherbi --help`);
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
    throw new Error(`--source must be SOURCE_ID=LOCAL_FILE, found ${JSON.stringify(assignment)}`);
   }
   const id = assignment.slice(0, split);
   if (Object.hasOwn(options.sources, id)) {
    throw new Error(`duplicate --source assignment for ${JSON.stringify(id)}`);
   }
   options.sources[id] = assignment.slice(split + 1);
   continue;
  }
  const key = { "--config": "config", "--mode": "mode", "--output": "output" }[
   flag
  ];
  if (!key || (!build && key !== "config")) {
   throw new Error(`unknown option ${JSON.stringify(flag)}`);
  }
  options[key] = nextValue(args, ++index, flag);
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

async function ensureValidator() {
 const generated = path.join(rootDir, ".generated", "validate-config.mjs");
 try {
  await access(generated);
 } catch {
  await import("../scripts/build-contract.mjs");
 }
}

function printHelp() {
 console.log(`featherbi validate --config CONFIG
featherbi build --config CONFIG --source ID=FILE [--source ID=FILE ...] --mode embedded|zip --output FILE [--overwrite]

Builds local artifacts only. It never publishes or uploads dashboard data.`);
}

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
 DUCKDB_SKILLS,
 acceptsAnswer,
 parseSetupArgs,
 runSetup,
 skillsCommand,
 verifySkillsLock,
} from "../../scripts/setup.mjs";

const rootDir = path.resolve(
 path.dirname(fileURLToPath(import.meta.url)),
 "../..",
);

/** Fake command runner: records invocations, fails configurable commands. */
function fakeRunner(fail = []) {
 const calls = [];
 return {
  calls,
  run: async (command, args) => {
   calls.push([command, ...args]);
   if (fail.includes(command)) {
    const error = new Error(`spawn ${command} ENOENT`);
    error.code = "ENOENT";
    throw error;
   }
   return { stdout: `${command} version 1.2.3\n` };
  },
 };
}

function deps(overrides = {}) {
 const runner = fakeRunner(overrides.fail);
 const lines = [];
 return {
  runner,
  lines,
  deps: {
   run: runner.run,
   exists: async (p) => {
    if (String(p).endsWith(".pi")) return;
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
   },
   readText: overrides.readText ?? (async () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
   }),
   cwd: "/tmp/project",
   platform: "linux",
   out: (line) => lines.push(line),
   ...overrides.deps,
  },
 };
}

test("setup parses --yes/--no/--agent and rejects unknown or conflicting input", () => {
 assert.deepEqual(parseSetupArgs([]), { yes: false, no: false, agent: null });
 assert.deepEqual(parseSetupArgs(["--yes"]), { yes: true, no: false, agent: null });
 assert.deepEqual(parseSetupArgs(["--agent", "claude"]), {
  yes: false,
  no: false,
  agent: "claude",
 });
 assert.throws(() => parseSetupArgs(["--silent"]), /unknown setup option/);
 assert.throws(() => parseSetupArgs(["--agent"]), /--agent requires a value/);
 assert.throws(
  () => parseSetupArgs(["--yes", "--no"]),
  /mutually exclusive/,
 );
});

test("the skills command line matches the official DuckDB skills invocation", () => {
 assert.deepEqual(skillsCommand("pi"), [
  "npx",
  "skills",
  "add",
  "duckdb/duckdb-skills",
  "--skill",
  ...DUCKDB_SKILLS,
  "--agent",
  "pi",
  "--yes",
  "--copy",
 ]);
});

test("setup reports every check without aborting when tools are missing", async () => {
 const { deps: injected, lines, runner } = deps({
  fail: ["uv", "/usr/bin/google-chrome"],
 });
 const { accepted, checks, exitCode } = await runSetup(["--no"], injected);
 assert.equal(accepted, false);
 assert.equal(exitCode, 0, "missing tools must not fail setup");
 assert.equal(checks.every((check) => "ok" in check), true);
 const uvCheck = checks.find(({ name }) => name === "uv");
 assert.equal(uvCheck.ok, false);
 assert.match(uvCheck.remedy, /install uv/);
 const chromeCheck = checks.find(({ name }) => name === "chrome");
 assert.equal(chromeCheck.ok, false);
 assert.match(chromeCheck.remedy, /desktop Google Chrome/);
 assert.equal(
  runner.calls.filter(([command]) => command === "npx").length,
  0,
  "declining must not run the install",
 );
 assert.ok(lines.some((line) => line.includes("Skipped the DuckDB skills install")));
});

test("declining prints the manual command; --yes runs it for the detected agent", async () => {
 const { deps: declined, lines: declinedLines } = deps();
 await runSetup(["--no"], declined);
 assert.ok(
  declinedLines.some((line) => line.includes("npx skills add duckdb/duckdb-skills")),
 );

 const { deps: accepted, runner } = deps();
 const { accepted: ran } = await runSetup(["--yes"], accepted);
 assert.equal(ran, true);
 const install = runner.calls.find(([command]) => command === "npx");
 assert.ok(install, "npx skills add must run on acceptance");
 assert.equal(install.includes("--agent"), true);
 assert.equal(install[install.indexOf("--agent") + 1], "pi");
});

test("a default-Yes prompt accepts an empty answer and EOF declines", async () => {
 const { deps: emptyDeps, runner: emptyRunner } = deps({
  deps: { prompt: async () => "" },
 });
 const { accepted } = await runSetup([], emptyDeps);
 assert.equal(accepted, true);
 assert.ok(emptyRunner.calls.some(([command]) => command === "npx"));

 const { deps: eofDeps, runner: eofRunner } = deps({
  deps: { prompt: async () => null },
 });
 const { accepted: eofAccepted } = await runSetup([], eofDeps);
 assert.equal(eofAccepted, false);
 assert.equal(
  eofRunner.calls.filter(([command]) => command === "npx").length,
  0,
  "EOF must decline without running the install",
 );
});

test("after install, setup verifies the skills-lock.json records", async () => {
 const lock = {
  version: 1,
  skills: Object.fromEntries(
   DUCKDB_SKILLS.map((skill) => [skill, { source: "duckdb/duckdb-skills" }]),
  ),
 };
 const { deps: withLock, lines } = deps({
  deps: {
   lockPath: "/tmp/project/skills-lock.json",
   readText: async () => JSON.stringify(lock),
  },
 });
 await runSetup(["--yes"], withLock);
 assert.ok(
  lines.some((line) => line.includes("skills-lock.json records all DuckDB skills")),
 );

 const { deps: partialLock, lines: partialLines } = deps({
  deps: {
   lockPath: "/tmp/project/skills-lock.json",
   readText: async () => JSON.stringify({ version: 1, skills: {} }),
  },
 });
 await runSetup(["--yes"], partialLock);
 assert.ok(
  partialLines.some((line) => line.includes("does not record: duckdb-docs")),
 );
});

test("verifySkillsLock classifies recorded and missing skills against the file", async () => {
 const scratch = await mkdtemp(path.join(os.tmpdir(), "featherbi-setup-"));
 const lockPath = path.join(scratch, "skills-lock.json");
 await writeFile(
  lockPath,
  JSON.stringify({
   version: 1,
   skills: { query: { source: "duckdb/duckdb-skills" } },
  }),
 );
 const result = await verifySkillsLock(lockPath, (p) => readFile(p, "utf8"));
 assert.deepEqual(result.recorded, ["query"]);
 assert.deepEqual(result.missing, DUCKDB_SKILLS.filter((s) => s !== "query"));
 const unreadable = await verifySkillsLock(
  path.join(scratch, "absent.json"),
  (p) => readFile(p, "utf8"),
 );
 assert.deepEqual(unreadable.recorded, []);
 assert.deepEqual(unreadable.missing, [...DUCKDB_SKILLS]);
 assert.match(unreadable.detail, /not readable/);
});

test("the bundled CLI documents and exposes the setup command", async () => {
 const { execFile } = await import("node:child_process");
 const { promisify } = await import("node:util");
 const help = await promisify(execFile)(process.execPath, [
  path.join(rootDir, "bin", "featherbi.mjs"),
  "--help",
 ]);
 assert.match(help.stdout, /featherbi setup/);
 const packageJson = JSON.parse(
  await readFile(path.join(rootDir, "package.json"), "utf8"),
 );
 const scripts = Object.keys(packageJson.scripts ?? {});
 assert.equal(
  scripts.some((script) => /pre|post/i.test(script) && script !== "pretest" && script !== "posttest"),
  false,
  "setup must stay explicit: no npm lifecycle hooks",
 );
});

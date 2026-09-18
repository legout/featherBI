import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
 DUCKDB_SKILLS,
 acceptsAnswer,
 designSkillsCommand,
 globalSkillsDir,
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

/** Fake fs effects for the global skill-link install; records operations. */
function fakeFs(existing = null) {
 const ops = { mkdir: [], rm: [], symlink: [] };
 return {
  ops,
  lstat: async () => {
   if (!existing) {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
   }
   return {
    isSymbolicLink: () => existing === "symlink",
    isDirectory: () => existing === "dir",
   };
  },
  mkdir: async (p) => {
   ops.mkdir.push(p);
  },
  rm: async (p) => {
   ops.rm.push(p);
  },
  symlink: async (target, linkPath) => {
   ops.symlink.push([target, linkPath]);
  },
 };
}

test("setup parses --yes/--no/--agent and rejects unknown or conflicting input", () => {
 assert.deepEqual(parseSetupArgs([]), {
  yes: false,
  no: false,
  agent: null,
  global: false,
  design: false,
 });
 assert.deepEqual(parseSetupArgs(["--yes"]), {
  yes: true,
  no: false,
  agent: null,
  global: false,
  design: false,
 });
 assert.deepEqual(parseSetupArgs(["--agent", "claude"]), {
  yes: false,
  no: false,
  agent: "claude",
  global: false,
  design: false,
 });
 assert.throws(() => parseSetupArgs(["--silent"]), /unknown setup option/);
 assert.throws(() => parseSetupArgs(["--agent"]), /--agent requires a value/);
 assert.throws(
  () => parseSetupArgs(["--yes", "--no"]),
  /mutually exclusive/,
 );
});

test("setup parses --global/--design; --design requires --global", () => {
 assert.deepEqual(parseSetupArgs(["--global"]), {
  yes: false,
  no: false,
  agent: null,
  global: true,
  design: false,
 });
 assert.deepEqual(parseSetupArgs(["--global", "--design", "--agent", "pi"]), {
  yes: false,
  no: false,
  agent: "pi",
  global: true,
  design: true,
 });
 assert.throws(
  () => parseSetupArgs(["--design"]),
  /--design requires --global/,
 );
 assert.throws(
  () => parseSetupArgs(["--global", "--wat"]),
  /unknown setup option/,
 );
 assert.throws(
  () => parseSetupArgs(["--global", "--yes", "--no"]),
  /mutually exclusive/,
 );
});

test("the skills command matches the official invocation; global adds -g only there", () => {
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
 assert.equal(skillsCommand("pi").includes("-g"), false);
 assert.deepEqual(skillsCommand("claude", { global: true }), [
  "npx",
  "skills",
  "add",
  "duckdb/duckdb-skills",
  "-g",
  "--skill",
  ...DUCKDB_SKILLS,
  "--agent",
  "claude",
  "--yes",
  "--copy",
 ]);
 assert.deepEqual(designSkillsCommand("claude"), [
  "npx",
  "skills",
  "add",
  "VoltAgent/awesome-claude-design",
  "-g",
  "--agent",
  "claude",
  "--yes",
 ]);
});

test("global skills dir resolution maps supported agents under home", () => {
 assert.equal(globalSkillsDir("pi", "/home/u"), "/home/u/.pi/agent/skills/featherbi");
 assert.equal(globalSkillsDir("claude", "/home/u"), "/home/u/.claude/skills/featherbi");
 assert.equal(globalSkillsDir("cursor", "/home/u"), "/home/u/.cursor/skills/featherbi");
 assert.equal(globalSkillsDir("gemini", "/home/u"), "/home/u/.gemini/skills/featherbi");
 assert.throws(() => globalSkillsDir("codex", "/home/u"), /supported agents/);
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

test("global setup checks featherbi on PATH with an install remedy; local does not", async () => {
 const { deps: globalDeps } = deps({ fail: ["featherbi"] });
 const { checks } = await runSetup(["--global", "--no"], globalDeps);
 const check = checks.find(({ name }) => name === "featherbi");
 assert.ok(check, "global mode must check featherbi on PATH");
 assert.equal(check.ok, false);
 assert.match(check.remedy, /npm i -g featherbi|npm link/);

 const { deps: localDeps } = deps({ fail: ["featherbi"] });
 const local = await runSetup(["--no"], localDeps);
 assert.equal(
  local.checks.some(({ name }) => name === "featherbi"),
  false,
  "local mode must not add the PATH check",
 );
});

test("global --yes links the package skill, runs the -g install, and --design is explicit", async () => {
 const fs = fakeFs();
 const { deps: injected, runner } = deps({
  deps: { home: "/home/u", ...fs },
 });
 const { accepted, skillLink, design } = await runSetup(
  ["--global", "--yes", "--design", "--agent", "claude"],
  injected,
 );
 assert.equal(accepted, true);
 assert.equal(skillLink.installed, true);
 assert.equal(skillLink.linkPath, "/home/u/.claude/skills/featherbi");
 assert.match(skillLink.target, /skill[/\\]featherbi$/);
 assert.deepEqual(fs.ops.symlink, [[skillLink.target, skillLink.linkPath]]);

 const npxCalls = runner.calls.filter(([command]) => command === "npx");
 const duckdb = npxCalls.find(([, , , repo]) => repo === "duckdb/duckdb-skills");
 assert.ok(duckdb, "global mode must install the DuckDB skills");
 assert.ok(duckdb.includes("-g"), "global DuckDB install must pass -g");
 const designCall = npxCalls.find(
  ([, , , repo]) => repo === "VoltAgent/awesome-claude-design",
 );
 assert.ok(designCall, "--design must add the design skill");
 assert.ok(designCall.includes("-g"));
 assert.equal(design.failed, false);
});

test("global --design --no installs design but never the DuckDB skills", async () => {
 const fs = fakeFs();
 const { deps: injected, lines, runner } = deps({
  deps: { home: "/home/u", ...fs },
 });
 const { accepted, design } = await runSetup(
  ["--global", "--design", "--no", "--agent", "gemini"],
  injected,
 );
 assert.equal(accepted, false);
 assert.equal(design.failed, false);
 const npxCalls = runner.calls.filter(([command]) => command === "npx");
 assert.equal(
  npxCalls.some(([, , , repo]) => repo === "duckdb/duckdb-skills"),
  false,
  "--no must decline the DuckDB install even in global mode",
 );
 assert.equal(
  npxCalls.some(([, , , repo]) => repo === "VoltAgent/awesome-claude-design"),
  true,
  "--design is explicit consent independent of the DuckDB prompt",
 );
 assert.ok(
  lines.some((line) => line.includes("-g") && line.includes("duckdb-skills")),
  "the decline hint must show the global command",
 );
});

test("a real directory at the global skills path is never clobbered; a symlink is replaced", async () => {
 const refused = fakeFs("dir");
 const { deps: refusedDeps, lines: refusedLines } = deps({
  deps: { home: "/home/u", ...refused },
 });
 const refusedResult = await runSetup(
  ["--global", "--yes", "--agent", "pi"],
  refusedDeps,
 );
 assert.equal(refusedResult.skillLink.installed, false);
 assert.equal(refusedResult.exitCode, 1);
 assert.match(refusedResult.skillLink.error, /not a featherbi symlink/);
 assert.deepEqual(refused.ops.symlink, []);
 assert.ok(
  refusedLines.some((line) => line.includes("not a featherbi symlink")),
 );

 const replaced = fakeFs("symlink");
 const { deps: replacedDeps } = deps({
  deps: { home: "/home/u", ...replaced },
 });
 const replacedResult = await runSetup(
  ["--global", "--yes", "--agent", "pi"],
  replacedDeps,
 );
 assert.equal(replacedResult.skillLink.installed, true);
 assert.deepEqual(replaced.ops.rm, ["/home/u/.pi/agent/skills/featherbi"]);
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
 // `prepare` is allowed: it runs only for the author at pack/publish/git-install
 // time; registry consumers never execute it (the #13 rule targets implicit
 // consumer-side setup).
 assert.equal(
  scripts.some(
   (script) =>
    /pre|post/i.test(script) &&
    script !== "pretest" &&
    script !== "posttest" &&
    script !== "prepare",
  ),
  false,
  "setup must stay explicit: no npm lifecycle hooks",
 );
});

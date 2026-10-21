import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
 designSkillsCommand,
 globalSkillsDir,
 parseSetupArgs,
 projectSkillsDir,
 runSetup,
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
   exists: async () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
   },
   cwd: "/tmp/project",
   platform: "linux",
   out: (line) => lines.push(line),
   ...fakeFs(),
   ...overrides.deps,
  },
 };
}

/** Fake fs effects for the skill install; records operations. */
function fakeFs(existing = null) {
 const ops = { mkdir: [], rm: [], symlink: [], cp: [] };
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
  cp: async (src, dest) => {
   ops.cp.push([src, dest]);
  },
 };
}

test("setup parses only --global/--design; removed switches are rejected", () => {
 assert.deepEqual(parseSetupArgs([]), {
  global: false,
  design: false,
 });
 assert.deepEqual(parseSetupArgs(["--global"]), {
  global: true,
  design: false,
 });
 assert.deepEqual(parseSetupArgs(["--global", "--design"]), {
  global: true,
  design: true,
 });
 assert.throws(() => parseSetupArgs(["--design"]), /--design requires --global/);
 assert.throws(() => parseSetupArgs(["--wat"]), /unknown setup option/);
 assert.throws(
  () => parseSetupArgs(["--agent", "claude"]),
  /unknown setup option/,
 );
 assert.throws(() => parseSetupArgs(["--yes"]), /unknown setup option/);
 assert.throws(() => parseSetupArgs(["--no"]), /unknown setup option/);
});

test("the design skills command targets the shared universal skills dir", () => {
 assert.deepEqual(designSkillsCommand(), [
  "npx",
  "skills",
  "add",
  "VoltAgent/awesome-claude-design",
  "-g",
  "--agent",
  "universal",
  "--yes",
 ]);
});

test("the single path resolves the shared .agents/skills destinations", () => {
 assert.equal(projectSkillsDir("/tmp/project"), "/tmp/project/.agents/skills/featherbi");
 assert.equal(globalSkillsDir("/home/u"), "/home/u/.agents/skills/featherbi");
});

test("setup reports every check without aborting when tools are missing", async () => {
 const { deps: injected, lines, runner } = deps({
  fail: ["uv", "/usr/bin/google-chrome"],
 });
 const { checks, exitCode } = await runSetup([], injected);
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
  "setup without --design must not run any install command",
 );
});

test("global setup checks featherbi on PATH with an install remedy; local does not", async () => {
 const { deps: globalDeps } = deps({ fail: ["featherbi"] });
 const { checks } = await runSetup(["--global"], globalDeps);
 const check = checks.find(({ name }) => name === "featherbi");
 assert.ok(check, "global mode must check featherbi on PATH");
 assert.equal(check.ok, false);
 assert.match(check.remedy, /npm i -g featherbi|npm link/);

 const { deps: localDeps } = deps({ fail: ["featherbi"] });
 const local = await runSetup([], localDeps);
 assert.equal(
  local.checks.some(({ name }) => name === "featherbi"),
  false,
  "local mode must not add the PATH check",
 );
});

test("plain setup copies the featherbi skill into the project's .agents/skills", async () => {
 const fs = fakeFs();
 const { deps: injected, lines } = deps({ deps: { ...fs } });
 const { skill, exitCode } = await runSetup([], injected);
 assert.equal(exitCode, 0, "the skill install must not fail setup");
 assert.equal(skill.installed, true);
 assert.equal(skill.installPath, "/tmp/project/.agents/skills/featherbi");
 assert.deepEqual(fs.ops.cp, [
  [skill.source, "/tmp/project/.agents/skills/featherbi"],
 ]);
 assert.deepEqual(
  fs.ops.symlink,
  [],
  "the project-local install must copy; never symlink the installed package",
 );
 assert.ok(lines.some((line) => line.includes("copied the featherbi skill")));
});

test("--global copies the skill into ~/.agents/skills; no scope symlinks", async () => {
 const fs = fakeFs();
 const { deps: injected } = deps({ deps: { home: "/home/u", ...fs } });
 const { skill } = await runSetup(["--global"], injected);
 assert.equal(skill.installed, true);
 assert.equal(
  skill.installPath,
  "/home/u/.agents/skills/featherbi",
  "global mode must copy into the shared ~/.agents/skills",
 );
 assert.deepEqual(fs.ops.cp, [
  [skill.source, "/home/u/.agents/skills/featherbi"],
 ]);
 assert.deepEqual(
  fs.ops.symlink,
  [],
  "global mode must copy, never create a symlink",
 );
});

test("--global --design runs the design install; a failure fails setup with the manual command", async () => {
 const fs = fakeFs();
 const { deps: injected, runner } = deps({
  deps: { home: "/home/u", ...fs },
 });
 const { design, exitCode } = await runSetup(["--global", "--design"], injected);
 assert.equal(design.failed, false);
 assert.equal(exitCode, 0);
 const npxCalls = runner.calls.filter(([command]) => command === "npx");
 assert.deepEqual(npxCalls, [designSkillsCommand()]);

 const failedFs = fakeFs();
 const { deps: failingDeps, lines } = deps({
  fail: ["npx"],
  deps: { home: "/home/u", ...failedFs },
 });
 const failed = await runSetup(["--global", "--design"], failingDeps);
 assert.equal(failed.design.failed, true);
 assert.equal(failed.exitCode, 1);
 assert.ok(
  lines.some((line) => line.includes("Run it manually with")),
  "the failure must print the manual command",
 );
 assert.equal(failed.skill.installed, true, "the skill copy still succeeds");
});

test("a real directory at the destination is never clobbered; a symlink is replaced by the copy", async () => {
 const projectRefused = fakeFs("dir");
 const { deps: projectDeps, lines: projectLines } = deps({
  deps: { ...projectRefused },
 });
 const projectResult = await runSetup([], projectDeps);
 assert.equal(projectResult.skill.installed, false);
 assert.equal(projectResult.exitCode, 1);
 assert.match(projectResult.skill.error, /not a featherbi skill copy/);
 assert.deepEqual(projectRefused.ops.cp, [], "a project-owned skill dir must never be overwritten");
 assert.ok(
  projectLines.some((line) => line.includes("not a featherbi skill copy")),
 );

 const globalRefused = fakeFs("dir");
 const { deps: globalDeps } = deps({
  deps: { home: "/home/u", ...globalRefused },
 });
 const globalResult = await runSetup(["--global"], globalDeps);
 assert.equal(globalResult.skill.installed, false);
 assert.equal(globalResult.exitCode, 1);
 assert.deepEqual(globalRefused.ops.cp, []);

 const replaced = fakeFs("symlink");
 const { deps: replacedDeps } = deps({
  deps: { home: "/home/u", ...replaced },
 });
 const replacedResult = await runSetup(["--global"], replacedDeps);
 assert.equal(replacedResult.skill.installed, true);
 assert.deepEqual(
  replaced.ops.rm,
  ["/home/u/.agents/skills/featherbi"],
  "an existing symlink destination is replaced",
 );
 assert.ok(replaced.ops.cp.length === 1);
});

test("the bundled CLI documents the single setup path and setup stays explicit", async () => {
 const { execFile } = await import("node:child_process");
 const { promisify } = await import("node:util");
 const help = await promisify(execFile)(process.execPath, [
  path.join(rootDir, "bin", "featherbi.mjs"),
  "--help",
 ]);
 assert.match(help.stdout, /featherbi setup \[--global\] \[--design\]/);
 assert.doesNotMatch(help.stdout, /--agent|--yes|--no/);
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

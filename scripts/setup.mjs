/**
 * featherbi setup: prerequisite checks plus the single skill-install path.
 *
 * Checks never abort: every tool reports ok/missing with an actionable
 * remedy. The bundled skill is copied into the project's .agents/skills
 * (default) or ~/.agents/skills (--global); an existing real directory or
 * file at the destination is never overwritten. There are deliberately no
 * npm lifecycle hooks: setup runs only when invoked.
 */

import { access, cp, lstat, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME_PATHS = {
 darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
 linux: [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
 ],
 win32: [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
 ],
};

/** Parse `featherbi setup` arguments; throws with the precise mistake. */
export function parseSetupArgs(argv) {
 const options = {
  global: false,
  design: false,
 };
 for (const flag of argv) {
  if (flag === "--global") options.global = true;
  else if (flag === "--design") options.design = true;
  else {
   throw new Error(
    `unknown setup option ${JSON.stringify(flag)}; supported: --global, --design`,
   );
  }
 }
 if (options.design && !options.global) {
  throw new Error("--design requires --global");
 }
 return options;
}

/** The opt-in design skills command line (global, never a default). */
export function designSkillsCommand() {
 return [
  "npx",
  "skills",
  "add",
  "VoltAgent/awesome-claude-design",
  "-g",
  // universal targets the shared ~/.agents/skills dir in the skills CLI
  "--agent",
  "universal",
  "--yes",
 ];
}

/** Where the global featherbi skill copy lives. */
export function globalSkillsDir(home = homedir()) {
 return path.join(home, ".agents/skills", "featherbi");
}

/** Where the project-local featherbi skill copy lives. */
export function projectSkillsDir(cwd = process.cwd()) {
 return path.join(cwd, ".agents/skills", "featherbi");
}

function nodeMajor() {
 return Number(process.versions.node.split(".")[0]);
}

/** Node >= 24 per package.json engines; never throws. */
export function checkNode() {
 const major = nodeMajor();
 return {
  name: "node",
  ok: major >= 24,
  detail: `v${process.versions.node}`,
  remedy:
   major >= 24
    ? null
    : "install Node.js 24 or newer (https://nodejs.org); featherbi requires >= 24",
 };
}

/** Probe one command; ok reports its first version-ish output line. */
async function probeCommand(run, command, args) {
 try {
  const { stdout } = await run(command, args, { encoding: "utf8" });
  const first = String(stdout).trim().split("\n")[0] ?? "";
  return { ok: true, detail: first };
 } catch (error) {
  return {
   ok: false,
   detail: error?.code === "ENOENT" ? "not found" : String(error.message).split("\n")[0],
  };
 }
}

export async function checkUv({ run } = {}) {
 if (!run) {
  ({ run } = await import("node:child_process").then((child) => ({
   run: promisifyExec(child.execFile),
  })));
 }
 const probe = await probeCommand(run, "uv", ["--version"]);
 return {
  name: "uv",
  ...probe,
  remedy: probe.ok
   ? null
   : "install uv (https://docs.astral.sh/uv/getting-started/installation/); featherbi uses it for DuckDB profiling",
 };
}

/** Probe the global featherbi CLI; ok means agents can invoke it anywhere. */
export async function checkFeatherbi({ run } = {}) {
 if (!run) {
  ({ run } = await import("node:child_process").then((child) => ({
   run: promisifyExec(child.execFile),
  })));
 }
 const probe = await probeCommand(run, "featherbi", ["--help"]);
 return {
  name: "featherbi",
  ...probe,
  remedy: probe.ok
   ? null
   : "install the featherbi CLI globally: npm i -g featherbi (or npm link from a checkout)",
 };
}

export async function checkChrome({ platform = process.platform, run, exists = access } = {}) {
 for (const candidate of CHROME_PATHS[platform] ?? []) {
  try {
   await exists(candidate);
  } catch {
   continue;
  }
  if (run) {
   const probe = await probeCommand(run, candidate, ["--version"]);
   return {
    name: "chrome",
    ok: probe.ok,
    detail: probe.ok ? probe.detail : candidate,
    remedy: probe.ok ? null : `reinstall desktop Google Chrome (${candidate})`,
   };
  }
  return { name: "chrome", ok: true, detail: candidate, remedy: null };
 }
 return {
  name: "chrome",
  ok: false,
  detail: "not found",
  remedy:
   "install desktop Google Chrome (https://www.google.com/chrome); dashboards open through file:// in Chrome",
 };
}

/**
 * Copy this package's skill/featherbi to installPath. Replaces an existing
 * symlink; never touches a real directory or file.
 */
async function installFeatherbiSkill({
 installPath,
 sourceDir,
 lstat: statLink = lstat,
 mkdir: makeDir = mkdir,
 rm: removePath = rm,
 cp: copyTree = cp,
}) {
 let existing = null;
 try {
  existing = await statLink(installPath);
 } catch {
  // absent: create it below
 }
 if (existing && !existing.isSymbolicLink()) {
  return {
   installed: false,
   installPath,
   error: `${installPath} already exists and is not a featherbi skill copy; remove or rename it, then rerun featherbi setup`,
  };
 }
 if (existing) {
  await removePath(installPath);
 } else {
  await makeDir(path.dirname(installPath), { recursive: true });
 }
 await copyTree(sourceDir, installPath, { recursive: true });
 return { installed: true, installPath, source: sourceDir };
}

/**
 * Run the full setup flow with injectable effects.
 * @param {string[]} argv
 * @param {object} [deps] run, exists, cwd, home, platform, lstat, mkdir,
 *   rm, cp, out (writer)
 */
export async function runSetup(argv = [], deps = {}) {
 const {
  run: injectedRun = null,
  exists = access,
  cwd = process.cwd(),
  home = homedir(),
  platform = process.platform,
  lstat: statLink,
  mkdir: makeDir,
  rm: removePath,
  cp: copyTree,
  out = (line) => console.log(line),
 } = deps;
 const run =
  injectedRun ??
  (await import("node:child_process").then((child) =>
   promisifyExec(child.execFile),
  ));
 const options = parseSetupArgs(argv);

 out("featherbi setup");
 const checks = [
  checkNode(),
  await checkUv({ run }),
  await checkChrome({ platform, run, exists }),
 ];
 if (options.global) checks.push(await checkFeatherbi({ run }));
 for (const check of checks) {
  const label = check.name.padEnd(9);
  if (check.ok) {
   out(`${label} ok (${check.detail})`);
  } else {
   out(`${label} missing — ${check.remedy}`);
  }
 }

 let exitCode = 0;
 const skill = await installFeatherbiSkill({
  installPath: options.global
   ? globalSkillsDir(home)
   : projectSkillsDir(cwd),
  sourceDir: fileURLToPath(new URL("../skill/featherbi", import.meta.url)),
  lstat: statLink,
  mkdir: makeDir,
  rm: removePath,
  cp: copyTree,
 });
 if (skill.installed) {
  out(`\ncopied the featherbi skill: ${skill.source} -> ${skill.installPath}`);
 } else {
  out(`\nfeatherbi skill install failed: ${skill.error}`);
  exitCode = 1;
 }

 let design = null;
 if (options.global && options.design) {
  const designCommand = designSkillsCommand();
  design = { command: designCommand, failed: false };
  out(`\nInstalling the design skill...`);
  try {
   await run(designCommand[0], designCommand.slice(1), {
    cwd,
    stdio: "inherit",
   });
  } catch (error) {
   design.failed = true;
   exitCode = 1;
   out(
    `the design skill install failed: ${error.message}. Run it manually with:\n  ${designCommand.join(" ")}`,
   );
  }
 }

 return { checks, skill, design, exitCode };
}

import { promisify } from "node:util";

function promisifyExec(execFile) {
 const execFileAsync = promisify(execFile);
 return (command, args, options) => execFileAsync(command, args, options);
}

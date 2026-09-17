/**
 * featherbi setup: environment checks plus the DuckDB agent-skills prompt.
 *
 * Checks never abort: every tool reports ok/missing with an actionable
 * remedy. The official DuckDB skills install runs only after an explicit
 * default-Yes confirmation (or --yes) and is recorded through the project's
 * skills-lock.json; declining prints a note and leaves nothing behind. There
 * are deliberately no npm lifecycle hooks: setup runs only when invoked.
 */

import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const DUCKDB_SKILLS = [
 "duckdb-docs",
 "query",
 "read-file",
 "s3-explore",
 "install-duckdb",
];

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

const AGENT_MARKERS = [
 [".pi", "pi"],
 [".claude", "claude"],
 [".cursor", "cursor"],
 [".gemini", "gemini"],
];

/** Parse `featherbi setup` arguments; throws with the precise mistake. */
export function parseSetupArgs(argv) {
 const options = { yes: false, no: false, agent: null };
 for (let index = 0; index < argv.length; index += 1) {
  const flag = argv[index];
  if (flag === "--yes") options.yes = true;
  else if (flag === "--no") options.no = true;
  else if (flag === "--agent") {
   if (index + 1 >= argv.length) {
    throw new Error("--agent requires a value");
   }
   options.agent = argv[++index];
  } else {
   throw new Error(
    `unknown setup option ${JSON.stringify(flag)}; supported: --yes, --no, --agent ID`,
   );
  }
 }
 if (options.yes && options.no) {
  throw new Error("--yes and --no are mutually exclusive");
 }
 return options;
}

/** The official DuckDB skills command line for one agent. */
export function skillsCommand(agent) {
 return [
  "npx",
  "skills",
  "add",
  "duckdb/duckdb-skills",
  "--skill",
  ...DUCKDB_SKILLS,
  "--agent",
  agent,
  "--yes",
  "--copy",
 ];
}

/** Best-effort agent detection from marker directories; pi is the default. */
export async function detectAgent(cwd, exists = access) {
 for (const [marker, agent] of AGENT_MARKERS) {
  try {
   await exists(path.join(cwd, marker));
   return agent;
  } catch {
   // no marker directory; try the next one
  }
 }
 return "pi";
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

/** Parse one default-Yes answer; empty input accepts, EOF (null) declines. */
export function acceptsAnswer(answer) {
 if (answer === null || answer === undefined) return false;
 const text = String(answer).trim().toLowerCase();
 if (text === "") return true;
 return ["y", "yes"].includes(text);
}

/**
 * Read skills-lock.json and classify the DuckDB skills as recorded or missing.
 * The external `skills` CLI owns writing the lock; setup only verifies it.
 */
export async function verifySkillsLock(lockPath, readText) {
 let expected;
 try {
  expected = JSON.parse(await readText(lockPath, "utf8"));
 } catch {
  return {
   recorded: [],
   missing: [...DUCKDB_SKILLS],
   detail: `skills-lock.json not readable at ${lockPath}; the skills CLI may not have recorded the install`,
  };
 }
 const names = new Set(Object.keys(expected?.skills ?? {}));
 return {
  recorded: DUCKDB_SKILLS.filter((skill) => names.has(skill)),
  missing: DUCKDB_SKILLS.filter((skill) => !names.has(skill)),
  detail: null,
 };
}

/**
 * Run the full setup flow with injectable effects.
 * @param {string[]} argv
 * @param {object} [deps] run, prompt, exists, readText, cwd, home, lockPath,
 *   platform, out (writer), err (writer)
 */
export async function runSetup(argv = [], deps = {}) {
 const {
  run: injectedRun = null,
  prompt = null,
  exists = access,
  readText,
  cwd = process.cwd(),
  lockPath,
  platform = process.platform,
  out = (line) => console.log(line),
 } = deps;
 const run =
  injectedRun ??
  (await import("node:child_process").then((child) =>
   promisifyExec(child.execFile),
  ));
 const options = parseSetupArgs(argv);
 const resolvedLockPath =
  lockPath ?? path.join(cwd, "skills-lock.json");
  const readLock = readText ?? readFile;

 out("featherbi setup");
 const checks = [
  checkNode(),
  await checkUv({ run }),
  await checkChrome({ platform, run, exists }),
 ];
 for (const check of checks) {
  const label = check.name.padEnd(7);
  if (check.ok) {
   out(`${label} ok (${check.detail})`);
  } else {
   out(`${label} missing — ${check.remedy}`);
  }
 }

 const agent = options.agent ?? (await detectAgent(cwd, exists));
 let accepted;
 if (options.yes) accepted = true;
 else if (options.no) accepted = false;
 else if (!prompt) {
  accepted = false;
 } else {
  accepted = acceptsAnswer(
   await prompt(
    `\nInstall the official DuckDB agent skills (${DUCKDB_SKILLS.join(", ")}) for ${agent}? [Y/n] `,
   ),
  );
 }

 if (!accepted) {
  out(
   `\nSkipped the DuckDB skills install. Run it anytime with:\n  ${skillsCommand(agent).join(" ")}`,
  );
  return { accepted: false, agent, checks, exitCode: 0 };
 }

 out(`\nInstalling DuckDB skills for ${agent}...`);
 const command = skillsCommand(agent);
 let install = { status: 0 };
 try {
  await run(command[0], command.slice(1), {
   cwd,
   stdio: "inherit",
  });
 } catch (error) {
  out(
   `the skills install failed: ${error.message}. Run it manually with:\n  ${command.join(" ")}`,
  );
  return { accepted: true, agent, checks, exitCode: 1 };
 }
 const lock = await verifySkillsLock(resolvedLockPath, readLock);
 if (lock.missing.length > 0) {
  out(
   `skills-lock.json does not record: ${lock.missing.join(", ")}. ${lock.detail ?? "Verify the install output above."}`,
  );
 } else {
  out(`skills-lock.json records all DuckDB skills: ${lock.recorded.join(", ")}`);
 }
 return { accepted: true, agent, checks, lock, exitCode: install?.status ?? 0 };
}

import { promisify } from "node:util";

function promisifyExec(execFile) {
 const execFileAsync = promisify(execFile);
 return (command, args, options) => execFileAsync(command, args, options);
}

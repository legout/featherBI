/**
 * featherBI authoring skill validation unit.
 *
 * The skill must stay installable and executable: strict frontmatter, every
 * local link resolves, bundled scripts answer --help, templates compile to
 * strict runtime contract 2, and the eval definitions it carries are
 * structurally sound with every execution case backed by a deterministic
 * check that actually runs here. Routing quality (which prompts trigger the
 * skill) is judged by humans from the fixture definitions, not by this file;
 * the deterministic checks prove the documented workflow compiles, rejects,
 * revises, and fails as described.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
 access,
 cp,
 mkdtemp,
 mkdir,
 readFile,
 readdir,
 rm,
 writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseDocument } from "yaml";
import { compileProject } from "../../authoring/compiler.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(
 path.dirname(fileURLToPath(import.meta.url)),
 "../..",
);
const skillDir = path.join(rootDir, "skill", "featherbi");

/** @returns {Promise<{frontmatter: object, body: string}>} */
async function readSkill() {
 const source = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
 const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
 assert.ok(match, "SKILL.md must open with YAML frontmatter");
 const document = parseDocument(match[1], { strict: true });
 assert.equal(
  document.errors.length,
  0,
  `frontmatter must parse strictly: ${document.errors[0]?.message}`,
 );
 return { frontmatter: document.toJS(), body: source.slice(match[0].length) };
}

/** Collect every relative markdown link target in one file. */
async function localLinks(file) {
 const source = await readFile(file, "utf8");
 return [...source.matchAll(/\]\(([^)]+)\)/g)]
  .map(({ 1: target }) => target)
  .filter(
   (target) =>
    !target.startsWith("http://") &&
    !target.startsWith("https://") &&
    !target.startsWith("#"),
  );
}

async function assertLinkTarget(base, target) {
 const resolved = path.resolve(base, target.split("#")[0]);
 await access(resolved);
 return resolved;
}

test("SKILL.md frontmatter parses strictly and routes local-data dashboard work", async () => {
 const { frontmatter } = await readSkill();
 assert.equal(frontmatter.name, "featherbi");
 assert.match(frontmatter.name, /^[a-z0-9-]+$/);
 const description = String(frontmatter.description ?? "");
 assert.ok(description.length >= 40, "description must describe routing");
 assert.ok(description.length <= 500, "description must stay concise");
 for (const phrase of ["dashboard", "data"]) {
  assert.ok(
   description.toLowerCase().includes(phrase),
   `description should mention ${phrase}`,
  );
 }
});

test("every local link in the skill resolves at exactly one reference level", async () => {
 const topLevel = await localLinks(path.join(skillDir, "SKILL.md"));
 assert.ok(topLevel.length > 0, "SKILL.md must link its progressive resources");
 const files = [path.join(skillDir, "SKILL.md")];
 for (const entry of await readdir(skillDir, {
  recursive: true,
  withFileTypes: true,
 })) {
  if (
   entry.isFile() &&
   entry.name.endsWith(".md") &&
   entry.parentPath !== path.join(skillDir, "SKILL.md")
  ) {
   files.push(path.join(entry.parentPath, entry.name));
  }
 }
 for (const file of files) {
  for (const target of await localLinks(file)) {
   const resolved = await assertLinkTarget(path.dirname(file), target);
   if (file !== path.join(skillDir, "SKILL.md")) {
    assert.ok(
     resolved !== path.join(skillDir, "SKILL.md"),
     "references must not link back into SKILL.md",
    );
   }
  }
 }
 for (const target of topLevel) {
  const depth = path
   .relative(skillDir, path.resolve(skillDir, target.split("#")[0]))
   .split(path.sep).length;
  assert.ok(depth <= 2, `SKILL.md links must stay one level deep: ${target}`);
 }
});

test("bundled scripts answer --help through the documented entry point", async () => {
 const { stdout } = await execFileAsync(
  process.execPath,
  [path.join(rootDir, "bin", "featherbi.mjs"), "--help"],
  { maxBuffer: 10_000 },
 );
 for (const command of ["profile", "compile", "validate", "build"]) {
  assert.ok(stdout.includes(command), `--help must document ${command}`);
 }
 await execFileAsync(
  "uv",
  ["run", "--script", path.join(skillDir, "scripts", "profile.py"), "--help"],
  { maxBuffer: 10_000 },
 );
});

test("the starter template compiles to strict contract 2", async () => {
 const work = await mkdtemp(
  path.join(os.tmpdir(), "featherbi-skill-template-"),
 );
 await cp(
  path.join(skillDir, "templates", "basic-dashboard"),
  path.join(work, "project"),
  { recursive: true },
 );
 const compiled = await compileProject(
  path.join(work, "project", "dashboard.yaml"),
 );
 assert.equal(compiled.config.contract, 2);
 assert.equal(compiled.config.data.mode, "upload");
 assert.equal(
  compiled.json.includes(path.join(work)),
  false,
  "generated config must not embed local paths",
 );
});

test("eval definitions define realistic triggers and four supported execution cases", async () => {
 const evals = JSON.parse(
  await readFile(path.join(skillDir, "evals", "evals.json"), "utf8"),
 );
 const triggers = evals.triggers ?? [];
 const positives = triggers.filter(({ expect }) => expect === "trigger");
 const nearMisses = triggers.filter(({ expect }) => expect === "near-miss");
 assert.ok(positives.length >= 3, "at least three positive triggers");
 assert.ok(nearMisses.length >= 3, "at least three near-miss triggers");
 for (const { prompt, expect, why } of triggers) {
  assert.ok(
   typeof prompt === "string" && prompt.length > 15,
   "trigger prompts must be realistic requests",
  );
  assert.ok(["trigger", "near-miss"].includes(expect));
  if (expect === "near-miss")
   assert.ok(why, "near-miss cases must say why the skill should stay quiet");
 }
 const execution = evals.execution ?? [];
 const required = [
  "single-source-dashboard",
  "ambiguous-join-stops",
  "appearance-feedback-rebuild",
  "failure-honesty",
 ];
 for (const id of required) {
  const evaluation = execution.find((entry) => entry.id === id);
  assert.ok(evaluation, `execution case ${id} must be defined`);
  assert.ok(
   evaluation.request.length > 15,
   "execution cases need a realistic request",
  );
  assert.ok(Array.isArray(evaluation.steps) && evaluation.steps.length >= 2);
  assert.ok(
   evaluation.evidence,
   "execution cases must name their expected evidence",
  );
 }
 assert.equal(
  execution.length,
  required.length,
  "every execution case needs a deterministic check; add both or neither",
 );
});

/** Write a minimal single-source project and return its dashboard path. */
async function writeProject(dir, yaml) {
 await mkdir(path.join(dir, "queries"), { recursive: true });
 await writeFile(path.join(dir, "dashboard.yaml"), yaml);
 await writeFile(
  path.join(dir, "queries", "total.sql"),
  "SELECT count(*) AS value FROM inspections\n",
 );
 return path.join(dir, "dashboard.yaml");
}

const BASE_YAML = `project: 1
title: Example dashboard
sources:
  - id: inspections
    type: json
    file: inspections.json
    schema:
      station: {type: string, nullable: false}
filters: []
relationships: []
queries:
  total:
    sql: queries/total.sql
    params: []
layout:
  - id: total
    type: kpi
    query: total
    label: Total records
    field: value
    x: 1
    y: 1
    width: 12
    height: 1
`;

test("single-source execution case compiles an ordinary dashboard", async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-skill-single-"));
 const dashboard = await writeProject(dir, BASE_YAML);
 const compiled = await compileProject(dashboard);
 assert.equal(compiled.config.contract, 2);
 assert.equal(compiled.config.data.sources.length, 1);
 assert.equal(compiled.config.layout[0].label, "Total records");
});

test("ambiguous-join execution case stops for an unconfirmed relationship", async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-skill-join-"));
 const yaml = `project: 1
title: Joined dashboard
sources:
  - id: inspections
    type: json
    file: inspections.json
    schema: {product_id: {type: string, nullable: false}}
  - id: products
    type: json
    file: products.json
    schema: {product_id: {type: string, nullable: false}}
filters: []
relationships: []
queries:
  total:
    sql: queries/total.sql
    params: []
layout:
  - id: total
    type: kpi
    query: total
    label: Total
    field: value
    x: 1
    y: 1
    width: 12
    height: 1
`;
 const dashboard = await writeProject(dir, yaml);
 await writeFile(
  path.join(dir, "queries", "total.sql"),
  "SELECT count(*) AS value FROM inspections JOIN products USING (product_id)\n",
 );
 await assert.rejects(
  () => compileProject(dashboard),
  /confirmed relationship/,
 );
});

test("appearance-feedback execution case changes the source and the rebuilt output visibly", async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-skill-feedback-"));
 const dashboard = await writeProject(dir, BASE_YAML);
 const before = (await compileProject(dashboard)).config;
 const feedback = BASE_YAML.replace(
  "label: Total records",
  "label: Inspections recorded",
 ).replace("y: 1", "y: 2");
 await writeFile(path.join(dir, "dashboard.yaml"), feedback);
 const after = (await compileProject(dashboard)).config;
 assert.equal(after.layout[0].label, "Inspections recorded");
 assert.equal(after.layout[0].y, 2);
 assert.equal(before.layout[0].label, "Total records");
 assert.equal(after.contract, 2);
});

test("failure-honesty execution case reports the exact source location", async () => {
 const dir = await mkdtemp(path.join(os.tmpdir(), "featherbi-skill-failure-"));
 const dashboard = await writeProject(dir, BASE_YAML);
 await rm(path.join(dir, "queries", "total.sql"));
 await assert.rejects(
  () => compileProject(dashboard),
  /queries\/total\.sql:1:1: cannot read/,
 );
});

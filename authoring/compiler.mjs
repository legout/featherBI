import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv";
import { LineCounter, parseDocument } from "yaml";
import projectSchema from "./schema.json" with { type: "json" };
import { validateConfig } from "../contract/config.mjs";

const validateProject = new Ajv({ allErrors: true }).compile(projectSchema);
const FORBIDDEN_SQL = /\b(?:ALTER|ATTACH|CALL|COPY|CREATE|DELETE|DETACH|DROP|EXPORT|IMPORT|INSERT|INSTALL|LOAD|MERGE|PRAGMA|TRUNCATE|UPDATE|VACUUM)\b/i;
const FILE_READER = /\b(?:read_csv|read_csv_auto|read_json|read_json_auto|read_ndjson|read_parquet|parquet_scan|csv_scan)\s*\(/i;

/** Compile one dashboard project into deterministic strict runtime contract 2. */
export async function compileProject(projectPath) {
 const resolved = path.resolve(projectPath);
 const root = path.dirname(resolved);
 const displayProject = path.basename(resolved);
 let source;
 let canonicalRoot;
 try {
  [source, canonicalRoot] = await Promise.all([
   readFile(resolved, "utf8"),
   realpath(root),
  ]);
 } catch (error) {
  throw new Error(`${displayProject}:1:1: cannot read project: ${error.message}`, { cause: error });
 }

 const lineCounter = new LineCounter();
 const document = parseDocument(source, {
  lineCounter,
  prettyErrors: false,
  strict: true,
  uniqueKeys: true,
 });
 if (document.errors.length > 0) {
  const error = document.errors[0];
  const position = error.linePos?.[0] ?? { line: 1, col: 1 };
  throw new Error(`${displayProject}:${position.line}:${position.col}: YAML ${error.message}`);
 }
 let project;
 try {
  project = document.toJS({ maxAliasCount: 0 });
 } catch (error) {
  throw new Error(`${displayProject}:1:1: YAML ${error.message}`, { cause: error });
 }
 if (!validateProject(project)) {
  const error = validateProject.errors[0];
  const projectPath = schemaErrorPath(error);
  const position = yamlPosition(document, lineCounter, projectPath);
  throw new Error(
   `${displayProject}:${position.line}:${position.col}: ${projectPath.join(".") || "project"} ${schemaMessage(error)}`,
  );
 }

 validateRelationships(project, displayProject, document, lineCounter);
 const queries = {};
 const declaredSources = new Set(project.sources.map(({ id }) => id));
 for (const queryId of Object.keys(project.queries).sort()) {
  const declaration = project.queries[queryId];
  const sqlLocation = ["queries", queryId, "sql"];
  const queryPath = path.resolve(root, declaration.sql);
  const relative = path.relative(path.join(root, "queries"), queryPath);
  if (
   relative.startsWith("..") ||
   path.isAbsolute(relative) ||
   path.extname(queryPath) !== ".sql"
  ) {
   throw yamlError(
    displayProject,
    document,
    lineCounter,
    sqlLocation,
    "query SQL must be a project-relative .sql file under queries/",
   );
  }
  let canonical;
  let sql;
  try {
   [canonical, sql] = await Promise.all([realpath(queryPath), readFile(queryPath, "utf8")]);
  } catch (error) {
   throw new Error(`${declaration.sql}:1:1: cannot read query SQL: ${error.message}`, { cause: error });
  }
  if (path.relative(path.join(canonicalRoot, "queries"), canonical).startsWith("..")) {
   throw yamlError(
    displayProject,
    document,
    lineCounter,
    sqlLocation,
    "query SQL symlink must stay under queries/",
   );
  }
  validateSql(sql, declaration.sql, declaration.params, declaredSources, project.relationships ?? []);
  queries[queryId] = { sql: normalizeNewline(sql), params: declaration.params };
 }

 const config = {
  contract: 2,
  app: "grid",
  title: project.title,
  data: { mode: "upload", sources: project.sources },
  filters: project.filters,
  queries,
  layout: project.layout,
 };
 const validation = validateConfig(config);
 if (!validation.ok) {
  const issue = validation.issues[0];
  const sourcePath = runtimePathToProjectPath(issue.path);
  throw yamlError(displayProject, document, lineCounter, sourcePath, issue.message);
 }
 return { config, json: `${JSON.stringify(sortObjectKeys(config), null, 2)}\n` };
}

function validateRelationships(project, filename, document, lineCounter) {
 const sources = new Map(project.sources.map((source) => [source.id, source]));
 for (const [index, relationship] of (project.relationships ?? []).entries()) {
  for (const side of ["left", "right"]) {
   const source = sources.get(relationship[side]);
   if (!source) {
    throw yamlError(filename, document, lineCounter, ["relationships", index, side], `references undeclared source ${JSON.stringify(relationship[side])}`);
   }
   const key = side === "left" ? "leftKey" : "rightKey";
   if (!Object.hasOwn(source.schema, relationship[key])) {
    throw yamlError(filename, document, lineCounter, ["relationships", index, key], `references undeclared column ${JSON.stringify(relationship[key])}`);
   }
  }
 }
}

function validateSql(sql, filename, params, declaredSources, relationships) {
 const normalized = normalizeNewline(sql);
 const masked = maskSql(normalized);
 const first = /[A-Za-z_][A-Za-z0-9_]*/.exec(masked);
 if (!first || !/^(?:SELECT|WITH)$/i.test(first[0])) {
  throw sqlError(filename, normalized, first?.index ?? 0, "query must be one SELECT statement");
 }
 const semicolons = [...masked.matchAll(/;/g)];
 if (
  semicolons.length > 1 ||
  (semicolons.length === 1 && masked.slice(semicolons[0].index + 1).trim() !== "")
 ) {
  throw sqlError(filename, normalized, semicolons[0]?.index ?? 0, "query must contain exactly one statement");
 }
 const forbidden = FORBIDDEN_SQL.exec(masked);
 if (forbidden) throw sqlError(filename, normalized, forbidden.index, `unsupported SQL keyword ${forbidden[0]}`);
 const reader = FILE_READER.exec(masked);
 if (reader) throw sqlError(filename, normalized, reader.index, "file readers are not supported");
 const external = /(?:https?:\/\/|file:|\.\.\/|\.\.\\|['"]\s*\/)/i.exec(normalized);
 if (external) throw sqlError(filename, normalized, external.index, "external URLs and filesystem paths are not supported");

 const joins = [...masked.matchAll(/\bJOIN\b/gi)];
 if (joins.length > 0 && relationships.length === 0) {
  throw sqlError(filename, normalized, joins[0].index, "joins require a confirmed relationship declaration");
 }
 const ctes = new Set(
  [...masked.matchAll(/(?:\bWITH\b|,)\s*([a-z][a-z0-9_]*)\s+AS\s*\(/gi)].map((match) => match[1]),
 );
 for (const match of masked.matchAll(/\b(?:FROM|JOIN)\s+([a-z][a-z0-9_]*)/gi)) {
  const source = match[1];
  if (!ctes.has(source) && !declaredSources.has(source)) {
   throw sqlError(filename, normalized, match.index + match[0].lastIndexOf(source), `undeclared source ${JSON.stringify(source)}`);
  }
 }
 const placeholders = [];
 for (const match of masked.matchAll(/\$([a-z][a-z0-9_]*)/gi)) {
  if (!placeholders.includes(match[1])) placeholders.push(match[1]);
 }
 if (placeholders.length !== params.length || placeholders.some((name, index) => name !== params[index])) {
  throw sqlError(filename, normalized, 0, `SQL parameters ${JSON.stringify(placeholders)} do not match declared params ${JSON.stringify(params)}`);
 }
}

function maskSql(sql) {
 const chars = [...sql];
 for (let index = 0; index < chars.length;) {
  if (chars[index] === "-" && chars[index + 1] === "-") {
   while (index < chars.length && chars[index] !== "\n") chars[index++] = " ";
  } else if (chars[index] === "/" && chars[index + 1] === "*") {
   chars[index++] = " "; chars[index++] = " ";
   while (index < chars.length && !(chars[index] === "*" && chars[index + 1] === "/")) {
    if (chars[index] !== "\n") chars[index] = " ";
    index += 1;
   }
   if (index < chars.length) { chars[index++] = " "; chars[index++] = " "; }
  } else if (chars[index] === "'") {
   chars[index++] = " ";
   while (index < chars.length) {
    if (chars[index] === "'" && chars[index + 1] === "'") {
     chars[index++] = " "; chars[index++] = " "; continue;
    }
    const done = chars[index] === "'";
    if (chars[index] !== "\n") chars[index] = " ";
    index += 1;
    if (done) break;
   }
  } else index += 1;
 }
 return chars.join("");
}

function normalizeNewline(value) {
 return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function sqlError(filename, sql, offset, message) {
 const before = sql.slice(0, offset);
 const line = before.split("\n").length;
 const column = offset - before.lastIndexOf("\n");
 return new Error(`${filename}:${line}:${column}: ${message}`);
}

function schemaErrorPath(error) {
 const parts = error.instancePath
  .split("/")
  .slice(1)
  .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
  .map((part) => /^\d+$/.test(part) ? Number(part) : part);
 if (error.keyword === "additionalProperties") parts.push(error.params.additionalProperty);
 if (error.keyword === "required") parts.push(error.params.missingProperty);
 return parts;
}

function schemaMessage(error) {
 if (error.keyword === "additionalProperties") return "must not have an additional property";
 if (error.keyword === "const") return `must be ${JSON.stringify(error.params.allowedValue)}`;
 return error.message ?? "is invalid";
}

function yamlPosition(document, lineCounter, sourcePath) {
 let node = document.getIn(sourcePath, true);
 if (!node && sourcePath.length > 0) node = document.getIn(sourcePath.slice(0, -1), true);
 return lineCounter.linePos(node?.range?.[0] ?? 0);
}

function yamlError(filename, document, lineCounter, sourcePath, message) {
 const position = yamlPosition(document, lineCounter, sourcePath);
 return new Error(`${filename}:${position.line}:${position.col}: ${message}`);
}

function runtimePathToProjectPath(runtimePath) {
 const pathParts = [];
 const normalized = runtimePath.replace(/^data\.sources/, "sources");
 for (const match of normalized.matchAll(/(?:^|\.)([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]/g)) {
  pathParts.push(match[1] ?? Number(match[2]));
 }
 return pathParts;
}

function sortObjectKeys(value) {
 if (Array.isArray(value)) return value.map(sortObjectKeys);
 if (value && typeof value === "object") {
  return Object.fromEntries(
   Object.keys(value).sort().map((key) => [key, sortObjectKeys(value[key])]),
  );
 }
 return value;
}

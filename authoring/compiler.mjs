import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv";
import { LineCounter, parseDocument } from "yaml";
import projectSchema from "./schema.json" with { type: "json" };
import { validateConfig } from "../contract/config.mjs";
import { scopeThemeCss } from "./css.mjs";

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
  const error = preferredSchemaError(validateProject.errors, project);
  const projectPath = schemaErrorPath(error);
  const position = yamlPosition(document, lineCounter, projectPath);
  throw new Error(
   `${displayProject}:${position.line}:${position.col}: ${projectPath.join(".") || "project"} ${schemaMessage(error)}`,
  );
 }

 validateRelationships(project, displayProject, document, lineCounter);
 validateCatalog(project, displayProject, document, lineCounter);
 validateLayout(project.layout, displayProject, document, lineCounter);
 const sourceIds = new Set(project.sources.map(({ id }) => id));
 const modelDeclarations = project.models ?? {};
 const modelSql = {};
 const modelDependencies = new Map();
 const declaredModelOrder = Object.keys(modelDeclarations);
 for (const modelId of declaredModelOrder) {
  const declaration = modelDeclarations[modelId];
  const sql = await readProjectSql({ root, canonicalRoot, declaration, kind: "model", id: modelId, displayProject, document, lineCounter });
  const allowed = new Set([...sourceIds, ...Object.keys(modelDeclarations)]);
  validateSql(sql, declaration.sql, [], allowed, project.relationships ?? []);
  const dependencies = sqlReferences(sql).filter((name) => Object.hasOwn(modelDeclarations, name));
  modelDependencies.set(modelId, dependencies);
  modelSql[modelId] = normalizeNewline(sql).trim().replace(/;\s*$/, "");
 }
 const modelOrder = topologicalModels(modelDependencies, displayProject, document, lineCounter);
 for (const [modelId, dependencies] of modelDependencies) {
  for (const dependency of dependencies) {
   if (declaredModelOrder.indexOf(dependency) >= declaredModelOrder.indexOf(modelId)) {
    throw yamlError(displayProject, document, lineCounter, ["models", modelId, "sql"], `model ${JSON.stringify(modelId)} must reference only earlier models; ${JSON.stringify(dependency)} is not earlier`);
   }
  }
 }
 const modelPrefix = modelOrder.map((id) => `${identifier(id)} AS (${modelSql[id]})`).join(",\n");
 const queries = {};
 for (const queryId of Object.keys(project.queries).sort()) {
  const declaration = project.queries[queryId];
  let sql;
  let params;
  if (Object.hasOwn(declaration, "sql")) {
   sql = await readProjectSql({ root, canonicalRoot, declaration, kind: "query", id: queryId, displayProject, document, lineCounter });
   validateSql(sql, declaration.sql, declaration.params, new Set([...sourceIds, ...Object.keys(modelDeclarations)]), project.relationships ?? []);
   params = declaration.params;
  } else {
   ({ sql, params } = compileMetricQuery(declaration, project));
  }
  queries[queryId] = { sql: withModels(sql, modelPrefix), params };
 }

 let themeCss;
 if (project.themeCss) {
  try {
   themeCss = await scopeThemeCss(await readFile(path.join(root, project.themeCss), "utf8"), project.themeCss);
  } catch (error) {
   throw error instanceof Error ? error : new Error(String(error));
  }
 }

 const config = {
  contract: 2,
  app: "grid",
  title: project.title,
  theme: project.theme ?? "neutral",
  data: { mode: "upload", sources: project.sources },
  filters: project.filters,
  queries,
  layout: project.layout,
 };
 if (themeCss) config.themeCss = themeCss;
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

async function readProjectSql({ root, canonicalRoot, declaration, kind, displayProject, document, lineCounter }) {
 const folder = `${kind === "model" ? "models" : "queries"}/`;
 const location = [kind === "model" ? "models" : "queries", arguments[0].id, "sql"];
 const sqlPath = path.resolve(root, declaration.sql);
 const relative = path.relative(path.join(root, folder), sqlPath);
 if (relative.startsWith("..") || path.isAbsolute(relative) || path.extname(sqlPath) !== ".sql") {
  throw yamlError(displayProject, document, lineCounter, location, `${kind} SQL must be a project-relative .sql file under ${folder}`);
 }
 let canonical;
 let sql;
 try {
  [canonical, sql] = await Promise.all([realpath(sqlPath), readFile(sqlPath, "utf8")]);
 } catch (error) {
  throw new Error(`${declaration.sql}:1:1: cannot read ${kind} SQL: ${error.message}`, { cause: error });
 }
 if (path.relative(path.join(canonicalRoot, folder), canonical).startsWith("..")) {
  throw yamlError(displayProject, document, lineCounter, location, `${kind} SQL symlink must stay under ${folder}`);
 }
 return sql;
}

function validateCatalog(project, filename, document, lineCounter) {
 const models = project.models ?? {};
 const dimensions = project.dimensions ?? {};
 const measures = project.measures ?? {};
 const filters = new Map(project.filters.map((filter) => [filter.id, filter]));
 for (const [id, dimension] of Object.entries(dimensions)) {
  const model = models[dimension.model];
  if (!model) throw yamlError(filename, document, lineCounter, ["dimensions", id, "model"], `references undeclared model ${JSON.stringify(dimension.model)}`);
  if (!Object.hasOwn(model.schema, dimension.field)) throw yamlError(filename, document, lineCounter, ["dimensions", id, "field"], `references undeclared model field ${JSON.stringify(dimension.field)}`);
 }
 for (const [id, measure] of Object.entries(measures)) {
  const model = models[measure.model];
  if (!model) throw yamlError(filename, document, lineCounter, ["measures", id, "model"], `references undeclared model ${JSON.stringify(measure.model)}`);
  if (measure.field && !Object.hasOwn(model.schema, measure.field)) throw yamlError(filename, document, lineCounter, ["measures", id, "field"], `references undeclared model field ${JSON.stringify(measure.field)}`);
  if (measure.aggregation && measure.aggregation !== "count" && !measure.field) throw yamlError(filename, document, lineCounter, ["measures", id], `${measure.aggregation} requires field`);
  if (measure.ratio) {
   for (const part of ["numerator", "denominator"]) {
    const dependency = measures[measure.ratio[part]];
    if (!dependency) throw yamlError(filename, document, lineCounter, ["measures", id, "ratio", part], `references undeclared measure ${JSON.stringify(measure.ratio[part])}`);
    if (dependency.ratio) throw yamlError(filename, document, lineCounter, ["measures", id, "ratio", part], "nested ratios are not supported");
    if (dependency.model !== measure.model) throw yamlError(filename, document, lineCounter, ["measures", id, "ratio", part], "ratio measures must use the same model");
   }
  }
 }
 for (const [index, filter] of project.filters.entries()) {
  if (!filter.dimension) continue;
  const dimension = dimensions[filter.dimension];
  if (!dimension) throw yamlError(filename, document, lineCounter, ["filters", index, "dimension"], `references undeclared dimension ${JSON.stringify(filter.dimension)}`);
  const source = project.sources.find(({ id }) => id === filter.source);
  if (!source || !Object.hasOwn(source.schema, filter.column)) continue;
  const modelField = models[dimension.model]?.schema[dimension.field];
  if (modelField?.type !== source.schema[filter.column].type) throw yamlError(filename, document, lineCounter, ["filters", index, "dimension"], "dimension and filter column types are incompatible");
 }
 for (const [id, query] of Object.entries(project.queries)) {
  if (!query.model) continue;
  if (!models[query.model]) throw yamlError(filename, document, lineCounter, ["queries", id, "model"], `references undeclared model ${JSON.stringify(query.model)}`);
  for (const dimensionId of query.dimensions ?? []) {
   const dimension = dimensions[dimensionId];
   if (!dimension || dimension.model !== query.model) throw yamlError(filename, document, lineCounter, ["queries", id, "dimensions"], `dimension ${JSON.stringify(dimensionId)} is not declared for model ${JSON.stringify(query.model)}`);
  }
  for (const measureId of query.measures) {
   const measure = measures[measureId];
   if (!measure || measure.model !== query.model) throw yamlError(filename, document, lineCounter, ["queries", id, "measures"], `measure ${JSON.stringify(measureId)} is not declared for model ${JSON.stringify(query.model)}`);
  }
  for (const filterId of query.filters ?? []) {
   const filter = filters.get(filterId);
   if (!filter || !filter.dimension || dimensions[filter.dimension]?.model !== query.model) throw yamlError(filename, document, lineCounter, ["queries", id, "filters"], `filter ${JSON.stringify(filterId)} is not compatible with model ${JSON.stringify(query.model)}`);
  }
 }
}

function validateLayout(layout, filename, document, lineCounter) {
 const ids = new Set(layout.map(({ id }) => id));
 const alternatives = new Map();
 for (const [index, container] of layout.entries()) {
  for (const tab of container.tabs ?? []) {
   for (const componentId of tab.components ?? []) {
    if (!ids.has(componentId)) throw yamlError(filename, document, lineCounter, ["layout", index, "tabs"], `references undeclared component ${JSON.stringify(componentId)}`);
    if (alternatives.has(componentId)) throw yamlError(filename, document, lineCounter, ["layout", index, "tabs"], `component ${JSON.stringify(componentId)} belongs to more than one tab`);
    alternatives.set(componentId, { owner: container.id, tab: tab.id });
   }
  }
 }
 for (let index = 0; index < layout.length; index += 1) {
  const item = layout[index];
  if (item.x + item.width - 1 > 12) throw yamlError(filename, document, lineCounter, ["layout", index, "width"], "placement exceeds the 12-column grid");
  for (let earlier = 0; earlier < index; earlier += 1) {
   const other = layout[earlier];
   const itemAlternative = alternatives.get(item.id);
   const otherAlternative = alternatives.get(other.id);
   const ownedAlternatives = itemAlternative && otherAlternative && itemAlternative.owner === otherAlternative.owner && itemAlternative.tab !== otherAlternative.tab;
   if (!ownedAlternatives && item.x < other.x + other.width && other.x < item.x + item.width && item.y < other.y + other.height && other.y < item.y + item.height) {
    throw yamlError(filename, document, lineCounter, ["layout", index], `placement overlaps component ${JSON.stringify(other.id)}`);
   }
  }
 }
}

function sqlReferences(sql) {
 const masked = maskSql(normalizeNewline(sql));
 const ctes = new Set([...masked.matchAll(/(?:\bWITH\b|,)\s*([a-z][a-z0-9_]*)\s+AS\s*\(/gi)].map((match) => match[1]));
 return [...masked.matchAll(/\b(?:FROM|JOIN)\s+([a-z][a-z0-9_]*)/gi)].map((match) => match[1]).filter((name) => !ctes.has(name));
}

function topologicalModels(dependencies, filename, document, lineCounter) {
 const result = [];
 const visiting = new Set();
 const visited = new Set();
 const visit = (id) => {
  if (visiting.has(id)) throw yamlError(filename, document, lineCounter, ["models", id], `model cycle includes ${JSON.stringify(id)}`);
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dependency of dependencies.get(id) ?? []) visit(dependency);
  visiting.delete(id); visited.add(id); result.push(id);
 };
 for (const id of dependencies.keys()) visit(id);
 return result;
}

function compileMetricQuery(query, project) {
 const dimensions = (query.dimensions ?? []).map((id) => project.dimensions[id]);
 const select = [
  ...(query.dimensions ?? []).map((id, index) => `${identifier(dimensions[index].field)} AS ${identifier(id)}`),
  ...query.measures.map((id) => `${measureSql(project.measures[id], project.measures)} AS ${identifier(id)}`),
 ];
 const predicates = [];
 const params = [];
 for (const filterId of query.filters ?? []) {
  const filter = project.filters.find(({ id }) => id === filterId);
  const dimension = project.dimensions[filter.dimension];
  const column = identifier(dimension.field);
  if (filter.kind === "date-range" || filter.kind === "numeric-range") {
   params.push(`${filter.id}_from`, `${filter.id}_to`);
   const upperOperator = filter.kind === "numeric-range" ? "<=" : "<";
   predicates.push(`($${filter.id}_from IS NULL OR ${column} >= $${filter.id}_from)`, `($${filter.id}_to IS NULL OR ${column} ${upperOperator} $${filter.id}_to)`);
  } else if (filter.kind === "multi-select") {
   params.push(filter.id);
   predicates.push(`($${filter.id} IS NULL OR json_contains($${filter.id}, to_json(${column})))`);
  } else {
   params.push(filter.id);
   predicates.push(`($${filter.id} IS NULL OR ${column} = $${filter.id})`);
  }
 }
 const group = dimensions.length ? `\nGROUP BY ${dimensions.map(({ field }) => identifier(field)).join(", ")}` : "";
 const order = query.orderBy?.length ? `\nORDER BY ${query.orderBy.map(identifier).join(", ")}` : "";
 return { sql: `SELECT ${select.join(", ")}\nFROM ${identifier(query.model)}${predicates.length ? `\nWHERE ${predicates.join(" AND ")}` : ""}${group}${order}\n`, params };
}

function measureSql(measure, measures) {
 let expression;
 if (measure.ratio) {
  const numerator = measureSql(measures[measure.ratio.numerator], measures);
  const denominator = measureSql(measures[measure.ratio.denominator], measures);
  expression = measure.zero === "zero" ? `CASE WHEN ${denominator} = 0 THEN 0 ELSE ${numerator} * 1.0 / ${denominator} END` : `${numerator} * 1.0 / NULLIF(${denominator}, 0)`;
 } else {
  const field = measure.field ? identifier(measure.field) : "*";
  const aggregation = { count: "count", sum: "sum", min: "min", max: "max", average: "avg" }[measure.aggregation];
  expression = measure.aggregation === "distinct-count" ? `count(DISTINCT ${field})` : `${aggregation}(${field})`;
 }
 return measure.empty === "zero" ? `COALESCE(${expression}, 0)` : expression;
}

function withModels(sql, prefix) {
 const normalized = normalizeNewline(sql).trim().replace(/;\s*$/, "");
 if (!prefix) return `${normalized}\n`;
 return /^WITH\b/i.test(normalized) ? `WITH ${prefix},\n${normalized.replace(/^WITH\s+/i, "")}\n` : `WITH ${prefix}\n${normalized}\n`;
}

function identifier(value) {
 return `"${String(value).replaceAll('"', '""')}"`;
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

function preferredSchemaError(errors, project) {
 for (const [id, measure] of Object.entries(project?.measures ?? {})) {
  if (!measure?.ratio) continue;
  const prefix = `/measures/${id}`;
  const missing = errors.find((error) => error.instancePath === prefix && error.keyword === "required" && !["aggregation", "field"].includes(error.params.missingProperty));
  if (missing) return missing;
 }
 return errors[0];
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

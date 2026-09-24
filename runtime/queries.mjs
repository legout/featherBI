import { Table, tableToIPC } from "apache-arrow";

const AST_SQL = "SELECT json_serialize_sql(CAST(? AS VARCHAR)) AS ast";
export const RESULT_MAX_ROWS = 10_000;
export const RESULT_MAX_BYTES = 8 * 1024 * 1024;
export const RESULT_TIMEOUT_MS = 30_000;

/**
 * Admit one authored SELECT through DuckDB's own parser metadata.
 *
 * @param {object} connection
 * @param {{sql: string, params: string[]}} query
 * @param {string[] | Set<string>} declaredSources
 */
export async function admitQuery(connection, query, declaredSources) {
 const { parsed, serialized } = await parseSql(connection, query?.sql);
 if (parsed.error) {
  throw rejected(parsed.error_message || "SQL could not be parsed");
 }
 if (parsed.statements?.length !== 1) {
  throw rejected("exactly one SELECT statement is required");
 }
 const statement = parsed.statements[0];
 if (statement?.node?.type !== "SELECT_NODE") {
  throw rejected("only SELECT statements are supported");
 }

 const nodes = walk(statement.node);
 if (nodes.some((node) => node.type === "TABLE_FUNCTION")) {
  throw rejected("table functions and file readers are not supported");
 }
 const external = nodes.find((node) => node.type === "VALUE_CONSTANT" && containsExternalReference(node.value));
 if (external) throw rejected("external URLs and filesystem paths are not supported");

 const ctes = new Set();
 for (const node of nodes) {
  for (const entry of node?.cte_map?.map ?? []) ctes.add(entry.key);
 }
 const allowed =
  declaredSources instanceof Set
   ? declaredSources
   : new Set(declaredSources ?? []);
 for (const node of nodes) {
  if (node.type !== "BASE_TABLE" || ctes.has(node.table_name)) continue;
  if (
   node.schema_name ||
   node.catalog_name ||
   !allowed.has(node.table_name)
  ) {
   throw rejected(`undeclared source ${JSON.stringify(node.table_name)}`);
  }
 }

 const parameterOrder = (statement.named_param_map ?? [])
  .slice()
  .sort((left, right) => Number(left.value) - Number(right.value))
  .map(({ key }) => String(key));
 const declaredParams = query?.params ?? [];
 if (
  parameterOrder.length !== declaredParams.length ||
  parameterOrder.some((name, index) => name !== declaredParams[index])
 ) {
  throw rejected(
   `parsed parameters ${JSON.stringify(parameterOrder)} do not match declared parameters ${JSON.stringify(declaredParams)}`,
  );
 }
 return {
  ordered: nodes.some((node) => node.type === "ORDER_MODIFIER"),
  parameterOrder,
  sql: await positionalSql(connection, serialized, parameterOrder),
 };
}

/**
 * Admit, prepare, bind, and execute one authored query.
 *
 * @param {object} connection
 * @param {{sql: string, params: string[]}} query
 * @param {Record<string, unknown>} values
 * @param {string[] | Set<string>} declaredSources
 * @param {{limit?: number, offset?: number, requireOrder?: boolean}} [options]
 */
export async function runQuery(
 connection,
 query,
 values,
 declaredSources,
 options = {},
) {
 const { ordered, parameterOrder, sql } = await admitQuery(
  connection,
  query,
  declaredSources,
 );
 if (options.requireOrder && !ordered) {
  throw rejected("paged table queries require ORDER BY");
 }
 const bound = parameterOrder.map((name) => {
  if (!Object.hasOwn(values, name)) {
   throw rejected(`missing value for parameter ${JSON.stringify(name)}`);
  }
  const value = values[name];
  return Array.isArray(value) ? (value.length ? JSON.stringify(value) : null) : value;
 });
 const limit = boundedInteger(options.limit, "limit", 1);
 const offset = boundedInteger(options.offset, "offset", 0) ?? 0;
 // pi-lens-ignore: ast-grep:no-sql-in-code-js
 const executable = limit
  ? `SELECT * FROM (${sql}) AS __featherbi_result LIMIT ${limit} OFFSET ${offset}`
  : sql;
 const statement = await connection.prepare(executable);
 try {
  const table = await statement.query(...bound);
  const names = resultColumnNames(table);
  const rows = table.toArray().map((row) => ({ ...row }));
  Object.defineProperty(rows, "fields", { value: names });
  return rows;
 } finally {
  await statement.close();
 }
}

/** Execute one admitted query as bounded Arrow IPC with real DuckDB cancellation. */
export async function runQueryArrow(
 connection,
 query,
 values,
 declaredSources,
 options = {},
) {
 const { parameterOrder, sql } = await admitQuery(connection, query, declaredSources);
 const bound = parameterOrder.map((name) => {
  if (!Object.hasOwn(values, name)) throw rejected(`missing value for parameter ${JSON.stringify(name)}`);
  const value = values[name];
  return Array.isArray(value) ? (value.length ? JSON.stringify(value) : null) : value;
 });
 const runnableSql = await bindRuntimeVariables(connection, sql, bound);
 const limit = boundedInteger(options.limit, "limit", 1);
 // pi-lens-ignore: ast-grep:no-sql-in-code-js
 const executable = limit ? `SELECT * FROM (${runnableSql}) AS __featherbi_result LIMIT ${limit}` : runnableSql;
 const timeoutMs = options.timeoutMs ?? RESULT_TIMEOUT_MS;
 let expired = false;
 let cancellation = Promise.resolve(false);
 let timer;
 try {
  await rejectDuplicateResultColumns(connection, runnableSql);
  timer = setTimeout(() => {
   expired = true;
   cancellation = connection.cancelSent();
  }, timeoutMs);
  const reader = await connection.send(executable);
  const { table, ipc } = await readBoundedArrow(reader, options.maxBytes, () => connection.cancelSent());
  if (expired) {
   const cancelled = await cancellation;
   if (!cancelled) throw new Error("DuckDB did not confirm cancellation");
   throw limitError(`query exceeded the ${timeoutMs}-ms time limit`, "queries.timeout");
  }
  resultColumnNames(table);
  return {
   table,
   ipc,
   rows: table.toArray().map((row) => ({ ...row })),
  };
 } catch (error) {
  if (expired) {
   const cancelled = await cancellation;
   if (!cancelled) throw new Error("DuckDB did not confirm cancellation", { cause: error });
   throw limitError(`query exceeded the ${timeoutMs}-ms time limit`, "queries.timeout");
  }
  throw error;
 } finally {
  clearTimeout(timer);
  await clearRuntimeVariables(connection, bound.length);
 }
}

/** Admit and execute one ephemeral recipient query against declared sources/models. */
export async function runPlaygroundQuery({
 connection,
 sql,
 declaredSources,
 models = [],
 timeoutMs = RESULT_TIMEOUT_MS,
}) {
 const modelPrefix = models.map(({ id, sql: modelSql }) => `${identifier(id)} AS (${String(modelSql).trim().replace(/;\s*$/, "")})`).join(",\n");
 const normalized = String(sql).trim().replace(/;\s*$/, "");
 const executable = modelPrefix
  ? (/^WITH\b/i.test(normalized) ? `WITH ${modelPrefix},\n${normalized.replace(/^WITH\s+/i, "")}` : `WITH ${modelPrefix}\n${normalized}`)
  : normalized;
 const allowed = new Set([...declaredSources, ...models.map(({ id }) => id)]);
 const result = await runQueryArrow(connection, { sql: executable, params: [] }, {}, allowed, {
  limit: RESULT_MAX_ROWS + 1,
  maxBytes: RESULT_MAX_BYTES,
  timeoutMs,
 });
 if (result.rows.length > RESULT_MAX_ROWS) throw limitError(`result exceeds the ${RESULT_MAX_ROWS.toLocaleString("en-US")}-row limit`, "queries.rows");
 if (result.ipc.byteLength > RESULT_MAX_BYTES) throw limitError("result exceeds the 8 MiB Arrow limit", "queries.bytes");
 return result;
}

async function rejectDuplicateResultColumns(connection, sql) {
 // Engine-owned result metadata preserves duplicate names before the limit wrapper normalizes them.
 const description = await connection.query(`DESCRIBE ${sql}`);
 validateResultColumnNames(description.toArray().map(({ column_name: name }) => String(name)));
}

function resultColumnNames(table) {
 const names = table.schema.fields.map(({ name }) => name);
 validateResultColumnNames(names);
 return names;
}

function validateResultColumnNames(names) {
 if (new Set(names).size !== names.length) throw rejected("query result has duplicate column names");
}

async function readBoundedArrow(reader, maxBytes, cancel) {
 const batches = [];
 // Arrow streams write the schema once, then one encapsulated message per batch, so a
 // single-batch stream minus the empty stream is exactly that batch's message bytes:
 // accounting per incoming batch costs one encode per batch instead of re-serializing the
 // whole accumulated result for every batch.
 const streamPrefixBytes = tableToIPC(new Table(reader.schema, []), "stream").byteLength;
 let accountedBytes = streamPrefixBytes;
 for await (const batch of reader) {
  batches.push(batch);
  if (maxBytes) {
   accountedBytes += tableToIPC(new Table(reader.schema, [batch]), "stream").byteLength - streamPrefixBytes;
   if (accountedBytes > maxBytes) {
    await Promise.all([reader.cancel(), cancel()]);
    throw limitError("result exceeds the 8 MiB Arrow limit", "queries.bytes");
   }
  }
 }
 const table = new Table(reader.schema, batches);
 const ipc = tableToIPC(table, "stream");
 if (maxBytes && ipc.byteLength > maxBytes) {
  throw limitError("result exceeds the 8 MiB Arrow limit", "queries.bytes");
 }
 return { table, ipc };
}

async function bindRuntimeVariables(connection, sql, values) {
 let bound = 0;
 try {
  for (const [index, value] of values.entries()) {
   // Runtime-owned SQL binds values before the cancellable raw query; values never become SQL text.
   const statement = await connection.prepare(`SET VARIABLE __featherbi_arg_${index + 1} = ?`);
   try {
    await statement.query(value);
   } finally {
    await statement.close();
   }
   bound += 1;
  }
 } catch (error) {
  await clearRuntimeVariables(connection, bound);
  throw error;
 }
 return replaceParameters(sql, values.length);
}

async function clearRuntimeVariables(connection, count) {
 for (let index = 1; index <= count; index += 1) {
  try {
   await connection.query(`RESET VARIABLE __featherbi_arg_${index}`);
  } catch {
   // Cancellation may already have closed query state; the connection remains owned and isolated.
  }
 }
}

function replaceParameters(sql, count) {
 let result = "";
 let quote = null;
 for (let index = 0; index < sql.length;) {
  const character = sql[index];
  if (quote) {
   result += character;
   if (character === quote && sql[index + 1] === quote) {
    result += sql[index + 1];
    index += 2;
    continue;
   }
   if (character === quote) quote = null;
   index += 1;
   continue;
  }
  if (character === "'" || character === '"') {
   quote = character;
   result += character;
   index += 1;
   continue;
  }
  const match = /^\$(\d+)/.exec(sql.slice(index));
  if (match && Number(match[1]) >= 1 && Number(match[1]) <= count) {
   result += `getvariable('__featherbi_arg_${match[1]}')`;
   index += match[0].length;
  } else {
   result += character;
   index += 1;
  }
 }
 return result;
}

async function parseSql(connection, sql) {
 if (typeof sql !== "string") throw rejected("SQL must be a string");
 const statement = await connection.prepare(AST_SQL);
 try {
  const rows = await statement.query(sql);
  const serialized = String(rows.toArray()[0].ast);
  return { parsed: JSON.parse(serialized), serialized };
 } finally {
  await statement.close();
 }
}

async function positionalSql(connection, serialized, parameterOrder) {
 let ast = serialized;
 parameterOrder.forEach((name, index) => {
  ast = ast.replaceAll(
   `"identifier":${JSON.stringify(name)}`,
   `"identifier":${JSON.stringify(String(index + 1))}`,
  );
 });
 const statement = await connection.prepare(
  "SELECT json_deserialize_sql(CAST(? AS VARCHAR)) AS sql",
 );
 try {
  const rows = await statement.query(ast);
  return String(rows.toArray()[0].sql);
 } finally {
  await statement.close();
 }
}

function containsExternalReference(value) {
 if (typeof value === "string") return /(?:https?:\/\/|file:|(?:^|[\\/])\.\.(?:[\\/]|$)|^(?:[A-Za-z]:[\\/]|[\\/]))/i.test(value);
 if (!value || typeof value !== "object") return false;
 return Object.values(value).some(containsExternalReference);
}

function walk(root) {
 const result = [];
 const visit = (value) => {
  if (!value || typeof value !== "object") return;
  result.push(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
   visit(child);
  }
 };
 visit(root);
 return result;
}

function boundedInteger(value, name, minimum) {
 if (value === undefined) return undefined;
 if (!Number.isSafeInteger(value) || value < minimum) {
  throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
 }
 return value;
}

function identifier(value) {
 return `"${String(value).replaceAll('"', '""')}"`;
}

function limitError(message, code) {
 const error = new Error(message);
 error.code = code;
 return error;
}

function rejected(message) {
 const error = new Error(`authored query rejected: ${message}`);
 error.code = "queries.rejected";
 return error;
}

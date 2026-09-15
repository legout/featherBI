const AST_SQL = "SELECT json_serialize_sql(CAST(? AS VARCHAR)) AS ast";

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
  return values[name];
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
  const names = table.schema.fields.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
   throw rejected("query result has duplicate column names");
  }
  const rows = table.toArray().map((row) => ({ ...row }));
  Object.defineProperty(rows, "fields", { value: names });
  return rows;
 } finally {
  await statement.close();
 }
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

function rejected(message) {
 const error = new Error(`authored query rejected: ${message}`);
 error.code = "queries.rejected";
 return error;
}

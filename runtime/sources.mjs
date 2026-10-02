import { DuckDBDataProtocol } from "@duckdb/duckdb-wasm";

const SQL_TYPES = {
 string: "VARCHAR",
 boolean: "BOOLEAN",
 integer: "BIGINT",
 number: "DOUBLE",
 date: "DATE",
 timestamp: "TIMESTAMP",
};
const INPUT_TYPES = new Set(["csv", "parquet", "json", "ndjson"]);
/** Upper bound on one live Parquet file set (spec 2026-09-28-0004 §2.1). */
const PARQUET_SET_MAX_FILES = 10_000;
/** Per-generation secret tags count down so newer generations sort first in
 * DuckDB's equal-score secret selection (verified against the pinned
 * DuckDB-WASM build): a staged candidate must shadow the active generation's
 * secret while it is staged and release it when the candidate is dropped. */
const SECRET_TAG_BASE = 1_000_000_000;
const SECRET_TAG_WIDTH = 9;
let nextGeneration = 1;

/**
 * Register `{source, file}` or `{source, bytes}` entries and create views whose
 * names are the declared source IDs. Embedded config source objects may be
 * passed directly when they contain base64 `content`. Sources carrying a
 * `remote` declaration are read live through httpfs instead of registered
 * bytes; `options.liveCredentials` maps source IDs to `{keyId, secret,
 * sessionToken?}` for private (`auth: "s3"`) live reads.
 *
 * @param {{db: object, connection: object}} engine
 * @param {Array<object> | {sources: Array<object>}} files
 * @param {{schema?: string, liveCredentials?: Map<string, object> | object}} [options]
 */
export async function registerSources(engine, files, options = {}) {
 const inputs = Array.isArray(files) ? files : files?.sources;
 if (!engine?.db || !engine?.connection) {
  throw new TypeError("registerSources requires an engine from createEngine()");
 }
 if (!inputs?.length) {
  throw new TypeError("registerSources requires at least one source file");
 }
 const seen = new Set();
 const sources = {};
 const generation = nextGeneration++;
 const generationSchema = options.schema ?? null;
 const registeredPhysicalNames = [];
 const createdSecretNames = [];
 if (generationSchema) {
  await runSql(
   engine.connection,
   `CREATE SCHEMA ${identifier(generationSchema)}`,
  );
 }
 for (const [index, input] of inputs.entries()) {
  const source = input.source ?? input;
  const id = source.id ?? input.id;
  if (typeof id !== "string" || id === "") {
   throw new Error(`source at index ${index} is missing a logical source id`);
  }
  if (seen.has(id.toLowerCase())) {
   throw sourceError(id, "duplicate source id", "sources.duplicate-id");
  }
  seen.add(id.toLowerCase());

  const schema = source.schema;
  const sqlTypes = schemaTypes(id, schema);
  const remote = source.remote ?? null;
  const parquetSet = remote?.kind === "parquet-set";
  const type = remote ? (parquetSet ? "parquet" : remoteFormat(id, remote)) : inputType(source, input);
  const physicalName = `__featherbi_source_${generation}_${index}.${type}`;
  try {
   let columns;
   let readerName;
   let readerPayload;
   let secretName = null;
   if (remote) {
    secretName = await prepareRemoteSource(engine, source, id, options.liveCredentials, generation);
    if (secretName) createdSecretNames.push(secretName);
    if (parquetSet) {
     // Membership resolves exactly once per generation (spec §3): the glob
     // expands to an explicit, capped, sorted file list and the view pins it,
     // so filter changes never re-resolve membership.
     const files = await resolveParquetSetFiles(engine.connection, id, remote);
     for (const file of files) {
      const fileColumns = await describeReader(
       engine.connection,
       `read_parquet(${stringLiteral(file)})`,
      );
      uniqueColumns(id, fileColumns, "PARQUET");
      missingColumns(id, schema, fileColumns);
     }
     columns = await describeReader(
      engine.connection,
      readerSql("parquet", remote.uri, { parquetFiles: files }),
     );
     readerName = remote.uri;
     readerPayload = { headers: columns, remote: true, parquetFiles: files };
    } else {
     readerName = remote.uri;
     columns = await describeReader(
      engine.connection,
      readerSql(type, readerName, { headers: [] }),
     );
     readerPayload = { headers: columns, remote: true };
    }
   } else {
    const payload = await payloadFor(source, input, id, type);
    await registerPayload(engine.db, physicalName, payload);
    registeredPhysicalNames.push(physicalName);
    readerName = physicalName;
    columns =
     type === "parquet"
      ? await describe(engine.connection, physicalName)
      : payload.headers;
    readerPayload = payload;
   }
   uniqueColumns(id, columns, type.toUpperCase());
   if (!(type === "json" && columns.length === 0)) {
    missingColumns(id, schema, columns);
   }

   const reader = readerSql(type, readerName, readerPayload);
   const view = reader
    ? `SELECT ${Object.keys(schema)
       .map(
        (column) =>
         `CAST(${identifier(column)} AS ${sqlTypes[column]}) AS ${identifier(column)}`,
       )
       .join(", ")} FROM ${reader}`
    : `SELECT ${Object.keys(schema)
       .map(
        (column) =>
         `CAST(NULL AS ${sqlTypes[column]}) AS ${identifier(column)}`,
       )
       .join(", ")} WHERE FALSE`;
   const logicalName = generationSchema
    ? `${identifier(generationSchema)}.${identifier(id)}`
    : identifier(id);
   await runSql(
    engine.connection,
    `CREATE OR REPLACE VIEW ${logicalName} AS ${view}`,
   );
   const typedColumns = Object.keys(schema).map(identifier).join(", ");
   await runSql(
    engine.connection,
    `SELECT count(hash(${typedColumns})) FROM ${logicalName}`,
   );
   await validateNullability(engine.connection, id, logicalName, schema);
   sources[id] = {
    physicalName: remote ? null : physicalName,
    view: logicalName,
    schema: generationSchema,
    secretName,
   };
  } catch (error) {
   if (generationSchema) {
    await discardGeneration(
     engine,
     generationSchema,
     registeredPhysicalNames,
     createdSecretNames,
    );
   } else {
    await dropLiveSecrets(engine, createdSecretNames);
   }
   if (error?.sourceId) throw error;
   throw sourceError(
    id,
    `unreadable file: ${error instanceof Error ? error.message : String(error)}`,
    "sources.unreadable-file",
   );
  }
 }
 return { sources };
}

async function validateNullability(connection, id, logicalName, schema) {
 const required = Object.entries(schema)
  .filter(([, declaration]) => declaration?.nullable === false)
  .map(([column]) => column);
 if (!required.length) return;
 const rows = await runSql(
  connection,
  `SELECT * FROM ${logicalName} WHERE ${required
   .map((column) => `${identifier(column)} IS NULL`)
   .join(" OR ")} LIMIT 1`,
 );
 if (rows.numRows > 0) {
  throw sourceError(
   id,
   "null value in a non-nullable declared column",
   "sources.nullability",
  );
 }
}

async function discardGeneration(engine, schema, physicalNames, secretNames = []) {
 try {
  await runSql(
   engine.connection,
   `DROP SCHEMA IF EXISTS ${identifier(schema)} CASCADE`,
  );
 } catch {
  // Preserve the actionable source error below; disposal is best effort.
 }
 for (const name of physicalNames) {
  try {
   await engine.db.dropFile(name);
  } catch {
   // A failed registration may not have left a removable file behind.
  }
 }
 await dropLiveSecrets(engine, secretNames);
}

/** Retire one generation's temporary live secrets (spec §3: only on cleanup). */
export async function dropLiveSecrets(engine, secretNames) {
 for (const name of secretNames) {
  try {
   await runSql(engine.connection, `DROP SECRET ${identifier(name)}`);
  } catch {
   // Cleanup stays best effort; a dropped secret cannot shadow anything.
  }
 }
}

function inputType(source, input) {
 const declared = String(input.type ?? source.type ?? "").toLowerCase();
 let name = "";
 if (typeof input.file === "string") name = input.file;
 else if (typeof source.file === "string") name = source.file;
 else if (input.file?.name) name = input.file.name;
 if (declared === "json" && /\.(ndjson|jsonl)$/i.test(name)) return "ndjson";
 if (!INPUT_TYPES.has(declared)) {
  throw sourceError(
   source.id ?? "unknown",
   `unsupported input type ${JSON.stringify(declared)}`,
   "sources.unsupported-type",
  );
 }
 return declared;
}

function schemaTypes(id, schema) {
 if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
  throw sourceError(id, "declared schema is missing", "sources.schema");
 }
 const result = {};
 const names = new Map();
 for (const [column, declaration] of Object.entries(schema)) {
  const prior = names.get(column.toLowerCase());
  if (prior !== undefined) {
   throw sourceError(
    id,
    `declared columns ${JSON.stringify(prior)} and ${JSON.stringify(column)} differ only by case`,
    "sources.duplicate-schema-column",
   );
  }
  names.set(column.toLowerCase(), column);
  const sqlType = SQL_TYPES[declaration?.type];
  if (!sqlType) {
   throw sourceError(
    id,
    `declared column ${JSON.stringify(column)} has unsupported type`,
    "sources.schema-type",
   );
  }
  result[column] = sqlType;
 }
 return result;
}

async function payloadFor(source, input, id, type) {
 let handle;
 if (isFile(input.handle)) handle = input.handle;
 else if (isFile(input.file)) handle = input.file;
 if (handle && type === "parquet") return { kind: "handle", value: handle };

 try {
  const raw = input.bytes ?? input.content ?? source.content;
  const bytes = handle ? null : toBytes(raw);
  if (type === "parquet") {
   return { kind: handle ? "handle" : "bytes", value: handle ?? bytes };
  }
  const text = handle
   ? await handle.text()
   : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return {
   kind: handle ? "handle" : "bytes",
   value: handle ?? bytes,
   headers: headersFor(type, text, id),
  };
 } catch (error) {
  if (error?.sourceId) throw error;
  throw sourceError(
   id,
   `unreadable file: ${error instanceof Error ? error.message : String(error)}`,
   "sources.unreadable-file",
  );
 }
}

async function registerPayload(db, name, payload) {
 try {
  if (payload.kind === "handle") {
   await db.registerFileHandle(
    name,
    payload.value,
    DuckDBDataProtocol.BROWSER_FILEREADER,
    true,
   );
  } else {
   await db.registerFileBuffer(name, payload.value);
  }
 } catch (error) {
  throw new Error(error instanceof Error ? error.message : String(error));
 }
}

/** Logical data format for one live remote source. */
function remoteFormat(id, remote) {
 const format = String(remote.format ?? "").toLowerCase();
 if (!INPUT_TYPES.has(format)) {
  throw sourceError(
   id,
   `unsupported remote format ${JSON.stringify(remote.format)}`,
   "sources.unsupported-type",
  );
 }
 return format;
}

/** In-memory secret name for one private live remote source's generation.
 * Generation 0 keeps the historical single-generation name; later
 * generations count down so the newest generation's secret sorts first in
 * DuckDB's equal-scope selection. */
export function liveSecretName(id, generation = 0) {
 const tag =
  generation > 0
   ? `_${String(SECRET_TAG_BASE - generation).padStart(SECRET_TAG_WIDTH, "0")}`
   : "";
 return `featherbi_live_${id}${tag}`;
}

/** Temporary config-provider secret SQL for one private live remote source. */
export function liveSecretSql(id, credentials, remote, generation = 0) {
 const options = [];
 if (credentials?.keyId && credentials?.secret) {
  options.push(
   `KEY_ID ${stringLiteral(credentials.keyId)}`,
   `SECRET ${stringLiteral(credentials.secret)}`,
  );
  if (credentials.sessionToken) {
   options.push(`SESSION_TOKEN ${stringLiteral(credentials.sessionToken)}`);
  }
 }
 if (remote.region) options.push(`REGION ${stringLiteral(remote.region)}`);
 if (remote.endpoint) {
  options.push(`ENDPOINT ${stringLiteral(remote.endpoint)}`);
  // ponytail: path-style for explicit endpoints; add a URL_STYLE override if a virtual-hosted S3-compatible endpoint appears.
  options.push("URL_STYLE 'path'");
 }
 if (remote.kind === "parquet-set") {
  // Scope the secret to the declared prefix so the listing and object reads
  // of this set never pick up another live source's credentials.
  options.push(`SCOPE ${stringLiteral(remote.uri)}`);
 }
 return `CREATE OR REPLACE TEMPORARY SECRET ${identifier(liveSecretName(id, generation))} (TYPE s3, PROVIDER config, ${options.join(", ")})`;
}

/**
 * Resolve one live Parquet set's glob into the generation's explicit file
 * list: capped, sorted, and provably below the declared prefix (spec §2.1).
 * @returns {Promise<string[]>}
 */
async function resolveParquetSetFiles(connection, id, remote) {
 const glob = remote.selector?.glob;
 if (
  typeof glob !== "string" ||
  glob === "" ||
  glob.startsWith("/") ||
  glob.split("/").includes("..") ||
  !glob.endsWith(".parquet")
 ) {
  throw sourceError(
   id,
   `invalid glob selector ${JSON.stringify(glob)}; use a relative pattern such as "year=*/part-*.parquet"`,
   "sources.parquet-set-glob",
  );
 }
 const pattern = `${remote.uri}${glob}`;
 const rows = await runSql(
  connection,
  `SELECT file FROM glob(${stringLiteral(pattern)}) LIMIT ${PARQUET_SET_MAX_FILES + 1}`,
 );
 const files = rows
  .toArray()
  .map((row) => String(row.file))
  .sort();
 if (files.length === 0) {
  throw sourceError(
   id,
   `glob ${JSON.stringify(glob)} under ${JSON.stringify(remote.uri)} resolved no Parquet files; check the prefix and pattern, the bucket's list permission, and CORS access for the browser`,
   "sources.parquet-set-empty",
  );
 }
 if (files.length > PARQUET_SET_MAX_FILES) {
  throw sourceError(
   id,
   `glob matched more than ${PARQUET_SET_MAX_FILES.toLocaleString("en-US")} Parquet files; narrow the selector glob`,
   "sources.parquet-set-limit",
  );
 }
 if (files.some((file) => !file.startsWith(remote.uri))) {
  throw sourceError(
   id,
   "glob resolution returned files outside the declared prefix",
   "sources.parquet-set-escape",
  );
 }
 return files;
}

/** Classify a failed live read: "credentials", "network", or "other". */
export function classifyLiveError(error) {
 const text = String(error?.message ?? error);
 if (
  /HTTP[^\n]*\b40[13]\b|\b401 Unauthorized\b|\b403 Forbidden\b|InvalidAccessKeyId|SignatureDoesNotMatch|ExpiredToken|token has expired|credential/i.test(
   text,
  )
 ) {
  return "credentials";
 }
 if (
  /CORS|Failed to fetch|NetworkError|Network request failed|Unable to connect|Connection refused|getaddrinfo|ENOTFOUND|name or service not known/i.test(
   text,
  )
 ) {
  return "network";
 }
 return "other";
}

/** Load httpfs and create the per-generation temporary secret for live reads.
 * Returns the secret name to retire with the generation, or null. */
async function prepareRemoteSource(engine, source, id, liveCredentials, generation = 0) {
 await runSql(engine.connection, "LOAD httpfs");
 const remote = source.remote;
 const parquetSet = remote.kind === "parquet-set";
 let credentials = null;
 if (remote.auth === "s3") {
  credentials =
   (liveCredentials instanceof Map
    ? liveCredentials.get(id)
    : liveCredentials?.[id]) ?? null;
  if (!credentials?.keyId || !credentials?.secret) {
   throw sourceError(
    id,
    "requires S3 credentials for the live read",
    "sources.credentials-required",
   );
  }
 } else if (!parquetSet) {
  return null;
 }
 // A public parquet-set still needs its endpoint/region secret for the
 // browser to resolve the s3:// prefix; it stays anonymous (no credentials).
 if (!credentials && !remote.region && !remote.endpoint) return null;
 await runSql(
  engine.connection,
  liveSecretSql(id, credentials, remote, generation),
 );
 return liveSecretName(id, generation);
}

async function describe(connection, name) {
 return describeReader(connection, `read_parquet(${stringLiteral(name)})`);
}

/** Column names for one reader fragment (registered file or remote URI). */
async function describeReader(connection, reader) {
 const table = await runSql(connection, `DESCRIBE SELECT * FROM ${reader}`);
 return table.toArray().map((row) => String(row.column_name));
}

function headersFor(type, text, id) {
 const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
 if (type === "csv") {
  const headers = csvHeader(input, id);
  uniqueColumns(id, headers, "CSV");
  return headers;
 }
 if (type === "json" || type === "ndjson") return jsonHeaders(type, input, id);
 throw sourceError(
  id,
  `unsupported input type ${JSON.stringify(type)}`,
  "sources.unsupported-type",
 );
}

function csvHeader(text, id) {
 if (text === "")
  throw sourceError(
   id,
   "unreadable file: CSV has no header row",
   "sources.unreadable-file",
  );
 const headers = [];
 let field = "";
 let quoted = false;
 let ended = false;
 for (let i = 0; i < text.length; i += 1) {
  const char = text[i];
  if (quoted) {
   if (char === '"' && text[i + 1] === '"') {
    field += '"';
    i += 1;
   } else if (char === '"') {
    quoted = false;
   } else {
    field += char;
   }
  } else if (char === '"' && field === "") {
   quoted = true;
  } else if (char === ",") {
   headers.push(field);
   field = "";
  } else if (char === "\n" || char === "\r") {
   headers.push(field);
   ended = true;
   break;
  } else {
   field += char;
  }
 }
 if (!ended) headers.push(field);
 if (quoted) {
  throw sourceError(
   id,
   "unreadable file: CSV header has an unterminated quote",
   "sources.unreadable-file",
  );
 }
 if (!headers.length || headers.some((header) => header === "")) {
  throw sourceError(
   id,
   "unreadable file: CSV header contains an empty column name",
   "sources.unreadable-file",
  );
 }
 return headers;
}

function jsonHeaders(type, text, id) {
 if (text.trim() === "") {
  throw sourceError(
   id,
   "unreadable file: JSON input is empty",
   "sources.unreadable-file",
  );
 }
 const headers = new Set();
 try {
  if (type === "ndjson") {
   let rows = 0;
   for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const value = JSON.parse(line);
    if (!plainObject(value))
     throw new Error("NDJSON rows must be flat objects");
    const keys = objectKeys(line);
    uniqueColumns(id, keys, "JSON");
    keys.forEach((key) => headers.add(key));
    rows += 1;
   }
   if (!rows) throw new Error("NDJSON input has no data rows");
  } else {
   const value = JSON.parse(text);
   if (!Array.isArray(value))
    throw new Error("JSON input must be an array of flat objects");
   let offset = skipWhitespace(text, 1);
   for (const row of value) {
    if (!plainObject(row)) throw new Error("JSON rows must be flat objects");
    offset = skipWhitespace(text, offset);
    const [keys, end] = readObject(text, offset);
    uniqueColumns(id, keys, "JSON");
    keys.forEach((key) => headers.add(key));
    offset = skipWhitespace(text, end);
    if (text[offset] === ",") offset += 1;
   }
  }
 } catch (error) {
  if (error?.sourceId) throw error;
  throw sourceError(
   id,
   `unreadable file: ${error instanceof Error ? error.message : String(error)}`,
   "sources.unreadable-file",
  );
 }
 return [...headers];
}

function objectKeys(text) {
 return readObject(text, skipWhitespace(text, 0))[0];
}

function readObject(text, start) {
 let index = skipWhitespace(text, start);
 if (text[index] !== "{") throw new Error("JSON rows must be flat objects");
 index += 1;
 const keys = [];
 while (true) {
  index = skipWhitespace(text, index);
  if (text[index] === "}") return [keys, index + 1];
  const [rawKey, keyEnd] = readString(text, index);
  let key;
  try {
   key = JSON.parse(rawKey);
  } catch {
   throw new Error("invalid JSON object key");
  }
  keys.push(key);
  index = skipWhitespace(text, keyEnd);
  if (text[index] !== ":") throw new Error("invalid JSON object");
  index = skipValue(text, index + 1);
  index = skipWhitespace(text, index);
  if (text[index] === "}") return [keys, index + 1];
  if (text[index] !== ",") throw new Error("invalid JSON object");
  index += 1;
 }
}

function skipValue(text, start) {
 let index = skipWhitespace(text, start);
 if (text[index] === '"') return readString(text, index)[1];
 if (text[index] === "{") return readObject(text, index)[1];
 if (text[index] === "[") {
  index += 1;
  while (true) {
   index = skipWhitespace(text, index);
   if (text[index] === "]") return index + 1;
   index = skipValue(text, index);
   index = skipWhitespace(text, index);
   if (text[index] === "]") return index + 1;
   if (text[index] !== ",") throw new Error("invalid JSON array");
   index += 1;
  }
 }
 while (index < text.length && !",]}\r\n \t".includes(text[index])) index += 1;
 return index;
}

function readString(text, start) {
 if (text[start] !== '"') throw new Error("JSON object key must be a string");
 let index = start + 1;
 while (index < text.length) {
  if (text[index] === "\\") index += 2;
  else if (text[index] === '"')
   return [text.slice(start, index + 1), index + 1];
  else index += 1;
 }
 throw new Error("unterminated JSON string");
}

function uniqueColumns(id, columns, kind) {
 const seen = new Map();
 for (const column of columns) {
  const prior = seen.get(column.toLowerCase());
  if (prior === undefined) seen.set(column.toLowerCase(), column);
  else if (prior === column) {
   throw sourceError(
    id,
    `duplicate ${kind} header ${JSON.stringify(column)}`,
    "sources.duplicate-header",
   );
  } else {
   throw sourceError(
    id,
    `case-colliding ${kind} headers ${JSON.stringify(prior)} and ${JSON.stringify(column)}`,
    "sources.case-colliding-header",
   );
  }
 }
}

function missingColumns(id, schema, columns) {
 const available = new Set(columns);
 for (const column of Object.keys(schema)) {
  if (!available.has(column)) {
   throw sourceError(
    id,
    `missing declared column ${JSON.stringify(column)}`,
    "sources.missing-column",
    column,
   );
  }
 }
}

function readerSql(type, name, payload) {
 if (type === "parquet") {
  // A pinned Parquet set reads its explicit resolved list; a single remote
  // or registered file reads its one URI/name.
  if (payload?.parquetFiles) {
   return `read_parquet([${payload.parquetFiles.map(stringLiteral).join(", ")}])`;
  }
  return `read_parquet(${stringLiteral(name)})`;
 }
 const path = stringLiteral(name);
 if (type === "csv")
  return `read_csv_auto(${path}, HEADER = TRUE, ALL_VARCHAR = TRUE)`;
 if (type === "ndjson")
  return `read_json_auto(${path}, FORMAT = 'newline_delimited')`;
 return payload.remote || payload.headers.length
  ? `read_json_auto(${path}, FORMAT = 'array')`
  : null;
}

function runSql(connection, sql) {
 return connection.query(sql);
}

function plainObject(value) {
 return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFile(value) {
 return (
  value !== null &&
  typeof value === "object" &&
  typeof value.text === "function" &&
  typeof value.name === "string"
 );
}

function toBytes(value) {
 if (value instanceof Uint8Array) return value;
 if (value instanceof ArrayBuffer) return new Uint8Array(value);
 if (ArrayBuffer.isView(value))
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
 if (typeof value === "string") return base64(value);
 if (
  plainObject(value) &&
  value.encoding === "base64" &&
  typeof value.value === "string"
 )
  return base64(value.value);
 throw new TypeError(
  "embedded bytes must be Uint8Array, ArrayBuffer, or base64 content",
 );
}

function base64(value) {
 if (typeof globalThis.atob === "function") {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
 }
 if (globalThis["Buffer"] !== undefined)
  return new Uint8Array(globalThis["Buffer"].from(value, "base64"));
 throw new Error("base64 decoding is unavailable");
}

function identifier(value) {
 return `"${String(value).replaceAll('"', '""')}"`;
}

function stringLiteral(value) {
 return `'${String(value).replaceAll("'", "''")}'`;
}

function sourceError(id, message, code, column) {
 const error = new Error(`source ${JSON.stringify(id)}: ${message}`);
 error.code = code;
 error.sourceId = id;
 if (column !== undefined) error.column = column;
 return error;
}

function skipWhitespace(text, index) {
 while (index < text.length && /\s/.test(text[index])) index += 1;
 return index;
}

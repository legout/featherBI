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
/** Upper bound on one Parquet-set manifest document (spec §2.1). */
const PARQUET_SET_MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
/** Shape every Parquet-set manifest document must have (spec §2.1). */
const PARQUET_SET_MANIFEST_URI = /^s3:\/\/[A-Za-z0-9._~/-]+\.json$/;
/** Shape every Iceberg metadata document URI must have, declared or
 * resolved from a catalog (spec §2.2): the versioned s3:// .metadata.json
 * document the T3 reader path and storage secret machinery pin to. */
const ICEBERG_METADATA_URI = /^s3:\/\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*\.metadata\.json$/;
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
 * sessionToken?}` for private (`auth: "s3"`) live reads. A catalog-identified
 * Iceberg table with `catalogAuth: "bearer"` resolves its REST endpoint with
 * one page-context fetch, so `options.liveCatalogTokens` maps source IDs to
 * that memory-only bearer token — it never reaches DuckDB or any secret.
 * `options.pinnedParquetFiles` maps source IDs to an already-resolved
 * Parquet-set file list so a re-stage (e.g. a credential retry) reuses that
 * membership instead of resolving the glob anew; likewise,
 * `options.pinnedIcebergMetadataUris` maps source IDs to an already-resolved
 * Iceberg metadata document so a re-stage reuses the pinned snapshot
 * instead of resolving the catalog anew.
 *
 * @param {{db: object, connection: object}} engine
 * @param {Array<object> | {sources: Array<object>}} files
 * @param {{schema?: string, liveCredentials?: Map<string, object> | object, liveCatalogTokens?: Map<string, string> | object, pinnedParquetFiles?: Map<string, string[]> | object, pinnedIcebergMetadataUris?: Map<string, string> | object}} [options]
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
 const pinnedParquetFiles = options.pinnedParquetFiles ?? null;
 const pinnedIcebergMetadataUris = options.pinnedIcebergMetadataUris ?? null;
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
  const iceberg = remote?.kind === "iceberg";
  const type = remote ? (parquetSet || iceberg ? "parquet" : remoteFormat(id, remote)) : inputType(source, input);
  const physicalName = `__featherbi_source_${generation}_${index}.${type}`;
  try {
   let columns;
   let readerName;
   let readerPayload;
   let secretName = null;
   let resolvedParquetFiles = null;
   let resolvedMetadataUri = null;
   if (remote) {
    // An Iceberg catalog identity resolves before its storage secret exists
    // (the resolved location scopes it); every other remote read prepares
    // its secret up front, unchanged.
    if (!iceberg) {
     secretName = await prepareRemoteSource(engine, source, id, options.liveCredentials, generation);
     if (secretName) createdSecretNames.push(secretName);
    }
    if (parquetSet) {
     // Membership resolves exactly once per generation (spec §3): the glob
     // expands or the manifest is fetched and validated to an explicit,
     // capped, sorted file list and the view pins it, so filter changes
     // never re-resolve membership. A re-stage that passes the active
     // generation's resolved list as pinned options reuses it instead of
     // resolving anew.
     const pinned =
      pinnedParquetFiles instanceof Map
       ? pinnedParquetFiles.get(id)
       : pinnedParquetFiles?.[id];
     const files =
      pinned ??
      (await resolveParquetSetFiles(
       engine,
       source,
       id,
       options.liveCredentials,
       generation,
      ));
     resolvedParquetFiles = files;
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
    } else if (iceberg) {
     // One Iceberg table resolves through its metadata document exactly
     // once per generation: the view pins the versioned metadata URI, so
     // the scan — including delete files — always targets that one
     // snapshot family until an explicit Refresh re-stages. A catalog
     // identity resolves `metadata-location` with ONE browser fetch first
     // (ADR 0009: never ATTACH ... TYPE ICEBERG, which re-resolves the
     // latest snapshot per scan) and pins the returned versioned document
     // for the whole generation (spec §2.2, §3; never read_parquet over
     // the data files). A re-stage that passes the active generation's
     // resolved document as pinned options reuses it instead of resolving
     // the catalog anew — like Parquet membership, only initial open and
     // explicit Refresh resolve the catalog.
     let metadataUri = remote.metadataUri;
     if (remote.catalog) {
      const pinnedMetadata =
       pinnedIcebergMetadataUris instanceof Map
        ? pinnedIcebergMetadataUris.get(id)
        : pinnedIcebergMetadataUris?.[id];
      metadataUri =
       pinnedMetadata ??
       (await resolveCatalogMetadataLocation(
        id,
        remote,
        catalogTokenOf(options, id),
       ));
     }
     // The storage secret scopes to the effective metadata document's table
     // root, so a catalog identity's resolved location (not a declaration
     // the catalog does not have) scopes the recipient's S3 credentials.
     secretName = await prepareRemoteSource(
      engine,
      source,
      id,
      options.liveCredentials,
      generation,
      metadataUri,
     );
     if (secretName) createdSecretNames.push(secretName);
     readerName = metadataUri;
     columns = await describeIceberg(engine.connection, id, readerName);
     readerPayload = { headers: columns, remote: true, iceberg: true };
     resolvedMetadataUri = metadataUri;
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
   const registration = {
    physicalName: remote ? null : physicalName,
    view: logicalName,
    schema: generationSchema,
    secretName,
   };
   if (resolvedParquetFiles) registration.parquetFiles = resolvedParquetFiles;
   if (resolvedMetadataUri) registration.icebergMetadataUri = resolvedMetadataUri;
   sources[id] = registration;
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

/** Generation tag for live secret names: generation 0 keeps the historical
 * single-generation name; later generations count down so the newest
 * generation's secret sorts first in DuckDB's equal-scope selection. */
function secretTag(generation = 0) {
 return generation > 0
  ? `_${String(SECRET_TAG_BASE - generation).padStart(SECRET_TAG_WIDTH, "0")}`
  : "";
}

/** In-memory secret name for one private live remote source's generation. */
export function liveSecretName(id, generation = 0) {
 return `featherbi_live_${id}${secretTag(generation)}`;
}

/** In-memory secret name for the one-shot manifest fetch of one Parquet
 * set. Auxiliary fetch secrets live in a namespace disjoint from every
 * source's storage secret: source ids match ^[a-z][a-z0-9_]*$, so this
 * name's hyphen can never be part of a source id and a manifest fetch can
 * never CREATE OR REPLACE or DROP another source's active
 * `featherbi_live_<id><tag>` secret (spec §4 isolation). */
export function manifestFetchSecretName(id, generation = 0) {
 return `featherbi_fetch-manifest_${id}${secretTag(generation)}`;
}

/** Temporary config-provider secret SQL for one private live remote source.
 * `scope` overrides the derived parquet-set prefix and iceberg table-root
 * scopes (a catalog identity passes the scope of its RESOLVED metadata
 * location; the manifest fetch secret scopes the same credentials to the
 * manifest object itself). `secretName` overrides the derived
 * `liveSecretName` for auxiliary fetch secrets (the manifest fetch passes
 * `manifestFetchSecretName`). */
export function liveSecretSql(
 id,
 credentials,
 remote,
 generation = 0,
 scope = null,
 secretName = null,
) {
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
  options.push(`SCOPE ${stringLiteral(scope ?? remote.uri)}`);
 }
 if (remote.kind === "iceberg") {
  // Scope the secret to the table location so the metadata and data object
  // reads share the recipient's credentials without covering other tables.
  // A catalog identity has no declared metadataUri to derive from: its
  // resolved metadata document's scope arrives as `scope`, and ignoring it
  // would create an unscoped secret competing with every other catalog
  // source's storage credentials (spec §3/§4 isolation).
  options.push(`SCOPE ${stringLiteral(scope ?? icebergScope(remote.metadataUri))}`);
 }
 return `CREATE OR REPLACE TEMPORARY SECRET ${identifier(secretName ?? liveSecretName(id, generation))} (TYPE s3, PROVIDER config, ${options.join(", ")})`;
}

/** S3 prefix scope for one Iceberg table's credentials: Iceberg lays out
 * `metadata/` beside `data/` under the table location, so the metadata
 * document's directory parent covers both kinds of reads; a flat layout
 * scopes to the document's own directory (spec 2026-09-28-0004 §2.2). */
export function icebergScope(metadataUri) {
 const directory = String(metadataUri).slice(0, String(metadataUri).lastIndexOf("/") + 1);
 const parent = directory.slice(0, -1);
 if (parent.endsWith("/metadata")) {
  return `${parent.slice(0, -"/metadata".length)}/`;
 }
 return directory;
}

/**
 * Resolve one live Parquet set's selector into the generation's explicit
 * file list (spec 2026-09-28-0004 §2.1): a glob expands once below the
 * declared prefix; a manifest is fetched once through the same
 * per-generation secret machinery and validated before anything is
 * admitted.
 * @returns {Promise<string[]>}
 */
async function resolveParquetSetFiles(engine, source, id, liveCredentials, generation = 0) {
 const remote = source.remote;
 if (remote.selector?.manifest !== undefined) {
  return resolveManifestParquetSet(engine, source, id, liveCredentials, generation);
 }
 return resolveGlobParquetSet(engine.connection, id, remote);
}

/** Resolve one Parquet set's glob selector into its bounded file list. */
async function resolveGlobParquetSet(connection, id, remote) {
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

/**
 * Resolve one Parquet set's manifest selector (spec §2.1): fetch the JSON
 * document once through the same httpfs/secret machinery as the files, then
 * validate it below. Unreadable manifests fail as source-tagged errors so
 * the candidate generation rolls back (LT-06).
 * @returns {Promise<string[]>}
 */
async function resolveManifestParquetSet(engine, source, id, liveCredentials, generation) {
 const remote = source.remote;
 const manifestUri = remote.selector.manifest;
 if (typeof manifestUri !== "string" || !PARQUET_SET_MANIFEST_URI.test(manifestUri)) {
  throw sourceError(
   id,
   `invalid manifest selector ${JSON.stringify(manifestUri)}; use an s3:// .json object such as "s3://reports/sales/manifest.json"`,
   "sources.parquet-set-manifest",
  );
 }
 let text;
 try {
  text = await fetchManifestText(engine, source, id, manifestUri, liveCredentials, generation);
 } catch (error) {
  if (error?.sourceId) throw error;
  throw sourceError(
   id,
   `cannot read manifest ${JSON.stringify(manifestUri)}: ${error instanceof Error ? error.message : String(error)}; check the manifest object, the bucket's read permission, and CORS access for the browser`,
   "sources.parquet-set-manifest",
  );
 }
 return manifestParquetFiles(id, remote.uri, manifestUri, text);
}

/**
 * Fetch one manifest document once through httpfs. A manifest outside the
 * declared prefix's secret scope gets its own one-shot secret — named in
 * the disjoint `manifestFetchSecretName` namespace — scoped to the manifest
 * object itself with the same credentials and endpoint, so manifest content
 * can never redirect the credential to another authority and the fetch
 * secret can never overwrite another source's storage secret (spec §4).
 * @returns {Promise<string>}
 */
export async function fetchManifestText(engine, source, id, manifestUri, liveCredentials, generation) {
 const remote = source.remote;
 const needsFetchSecret =
  !manifestUri.startsWith(remote.uri) &&
  (remote.auth === "s3" || remote.region || remote.endpoint);
 if (needsFetchSecret) {
  const credentials =
   (liveCredentials instanceof Map
    ? liveCredentials.get(id)
    : liveCredentials?.[id]) ?? null;
  await runSql(
   engine.connection,
   liveSecretSql(
    id,
    credentials,
    { ...remote, uri: manifestUri },
    generation,
    null,
    manifestFetchSecretName(id, generation),
   ),
  );
 }
 try {
  const rows = await runSql(
   engine.connection,
   `SELECT content FROM read_text(${stringLiteral(manifestUri)})`,
  );
  const row = rows.numRows === 1 ? rows.toArray()[0] : null;
  if (typeof row?.content !== "string") {
   throw sourceError(
    id,
    `manifest ${JSON.stringify(manifestUri)} is not a readable document`,
    "sources.parquet-set-manifest",
   );
  }
  return row.content;
 } finally {
  if (needsFetchSecret) {
   await dropLiveSecrets(engine, [manifestFetchSecretName(id, generation)]);
  }
 }
}

/** One rejection reason for an invalid manifest entry, or null. */
function manifestEntryReason(entry) {
 if (typeof entry !== "string") return "is not a string";
 if (entry === "") return "is empty";
 if (/[\u0000-\u001f\u007f]/.test(entry)) return "contains control characters";
 if (entry.startsWith("/")) return "is absolute; entries are relative to the declared prefix";
 if (entry.includes("://")) return "is a URL, not a relative object key";
 if (entry.includes("\\")) return 'uses a backslash separator; use "/"';
 if (entry.split("/").includes("..")) return 'escapes the declared prefix with ".."';
 if (entry.includes("?") || entry.includes("#"))
  return "carries a query or fragment; entries are plain object keys";
 if (!entry.endsWith(".parquet")) return "is not a Parquet object";
 return null;
}

/**
 * Validate one fetched Parquet-set manifest document (spec
 * 2026-09-28-0004 §2.1) into the generation's explicit file list: the 2 MiB
 * cap applies before parsing, every entry must be a relative Parquet key
 * below the declared prefix, exact duplicates deduplicate, distinct keys
 * stay case-sensitive, and the result is capped, sorted, and prefixed.
 * Throws before any view can publish the membership (LT-03).
 * @param {string} id
 * @param {string} prefix
 * @param {string} manifestUri
 * @param {string} text
 * @returns {string[]}
 */
export function manifestParquetFiles(id, prefix, manifestUri, text) {
 const describe = (message, code) =>
  sourceError(id, `manifest ${JSON.stringify(manifestUri)} ${message}`, code);
 if (typeof text !== "string" || text.trim() === "") {
  throw describe("is empty or unreadable", "sources.parquet-set-manifest");
 }
 if (
  text.length > PARQUET_SET_MANIFEST_MAX_BYTES ||
  byteLength(text) > PARQUET_SET_MANIFEST_MAX_BYTES
 ) {
  throw describe(
   "exceeds the 2 MiB limit; split the file set or narrow the manifest",
   "sources.parquet-set-manifest-size",
  );
 }
 let document;
 try {
  document = JSON.parse(text);
 } catch (error) {
  throw describe(
   `is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
   "sources.parquet-set-manifest",
  );
 }
 const entries = plainObject(document) ? document.files : undefined;
 if (!Array.isArray(entries)) {
  throw describe(
   'must be a JSON object like {"files": ["year=2026/part-1.parquet"]}',
   "sources.parquet-set-manifest",
  );
 }
 const seen = new Set();
 const files = [];
 for (const entry of entries) {
  const reason = manifestEntryReason(entry);
  if (reason !== null) {
   throw sourceError(
    id,
    `manifest entry ${JSON.stringify(entry)} ${reason}; manifest entries are relative Parquet keys below ${JSON.stringify(prefix)}`,
    "sources.parquet-set-manifest-entry",
   );
  }
  const file = `${prefix}${entry}`;
  if (!file.startsWith(prefix)) {
   throw sourceError(
    id,
    `manifest entry ${JSON.stringify(entry)} resolves outside the declared prefix ${JSON.stringify(prefix)}`,
    "sources.parquet-set-manifest-entry",
   );
  }
  // Exact duplicates deduplicate; distinct keys stay case-sensitive.
  if (!seen.has(file)) {
   seen.add(file);
   files.push(file);
  }
 }
 if (files.length === 0) {
  throw describe(
   'lists no Parquet files; check its "files" list',
   "sources.parquet-set-empty",
  );
 }
 if (files.length > PARQUET_SET_MAX_FILES) {
  throw describe(
   `lists more than ${PARQUET_SET_MAX_FILES.toLocaleString("en-US")} Parquet files; narrow the manifest`,
   "sources.parquet-set-limit",
  );
 }
 return files.sort();
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
 * `metadataUri` is the effective Iceberg metadata document — declared, or
 * resolved from a catalog — so the secret scopes to the table the
 * generation actually scans. Returns the secret name to retire with the
 * generation, or null. */
async function prepareRemoteSource(engine, source, id, liveCredentials, generation = 0, metadataUri = null) {
 await runSql(engine.connection, "LOAD httpfs");
 const remote = source.remote;
 const parquetSet = remote.kind === "parquet-set";
 const iceberg = remote.kind === "iceberg";
 if (iceberg) {
  // Trusted runtime code loads the Iceberg capability (spec §3): the
  // pinned DuckDB-WASM build fetches the official version/platform artifact
  // from its default trusted repository (ADR 0009) — the WASM build ignores
  // custom extension repositories, and no project-authored location exists
  // to accept. A failed load is a visible source error, never a fallback.
  try {
   await runSql(engine.connection, "LOAD iceberg");
  } catch (error) {
   throw sourceError(
    id,
    `cannot load the trusted Iceberg capability: ${error instanceof Error ? error.message : String(error)}; the pinned DuckDB build fetches it from its trusted extension repository, so check the browser's network access`,
    "sources.iceberg-capability",
   );
  }
 }
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
 } else if (!parquetSet && !iceberg) {
  return null;
 }
 // A public Parquet set or Iceberg table still needs its endpoint/region
 // secret for the browser to resolve the s3:// location; it stays anonymous
 // (no credentials).
 if (!credentials && !remote.region && !remote.endpoint) return null;
 await runSql(
  engine.connection,
  liveSecretSql(
   id,
   credentials,
   remote,
   generation,
   iceberg && metadataUri ? icebergScope(metadataUri) : null,
  ),
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

/** Columns of one declared Iceberg table resolved through the pinned reader.
 * The first resolve happens here, inside candidate staging, so an
 * unreadable or unsupported table fails visibly and rolls the candidate
 * generation back (LT-06). */
async function describeIceberg(connection, id, metadataUri) {
 try {
  return await describeReader(
   connection,
   `iceberg_scan(${stringLiteral(metadataUri)})`,
  );
 } catch (error) {
  if (error?.sourceId) throw error;
  throw sourceError(
   id,
   `cannot read the Iceberg table at ${JSON.stringify(metadataUri)}: ${error instanceof Error ? error.message : String(error)}; check the metadata document, the table's objects, and CORS access for the browser`,
   "sources.iceberg",
  );
 }
}

/** The catalog token for one source from the staging options, if any. */
function catalogTokenOf(options, id) {
 const tokens = options.liveCatalogTokens;
 if (tokens instanceof Map) return tokens.get(id) ?? null;
 return tokens?.[id] ?? null;
}

/** REST table URL for one declared catalog identity: the warehouse is the
 * path prefix segment under `/v1` (ticket #34 / T0 verdict). */
export function catalogTableUrl(catalog) {
 const base = String(catalog.endpoint).replace(/\/+$/, "");
 return `${base}/v1/${encodeURIComponent(catalog.warehouse)}/namespaces/${encodeURIComponent(catalog.namespace)}/tables/${encodeURIComponent(catalog.table)}`;
}

/**
 * Resolve one catalog-identified Iceberg table's current metadata location
 * with a single browser fetch (spec §2.2, §3; ADR 0009: a REST attachment
 * re-resolves the latest snapshot per scan, so trusted runtime code pins
 * the versioned metadata URI itself). The recipient's bearer token — only
 * when `catalogAuth` is "bearer" — exists solely in this request's
 * `Authorization` header: it never enters DuckDB, SQL, a secret, an error
 * message, or the resolved URI. A cross-origin redirect strips that header
 * by fetch-spec behavior, and the resolution still fails visibly naming
 * the endpoint, so the token is never forwarded to another authority
 * (spec §4). Every unpinnable outcome (missing, non-s3, or malformed
 * `metadata-location`) is a catalog error naming the endpoint/source.
 * @param {string} id
 * @param {{catalog?: object, catalogAuth?: string}} remote
 * @param {string | null} token
 * @returns {Promise<string>}
 */
export async function resolveCatalogMetadataLocation(id, remote, token) {
 const catalog = remote.catalog;
 const url = catalogTableUrl(catalog);
 const headers = {};
 if (remote.catalogAuth === "bearer") {
  if (typeof token !== "string" || token === "") {
   throw sourceError(
    id,
    "requires a catalog bearer token for the live read",
    "sources.credentials-required",
   );
  }
  headers.Authorization = `Bearer ${token}`;
 }
 let response;
 try {
  response = await fetch(url, { headers });
 } catch (error) {
  throw sourceError(
   id,
   `catalog endpoint ${JSON.stringify(catalog.endpoint)} could not be reached (${error instanceof Error ? error.message : String(error)}); check the endpoint and its CORS access for the browser`,
   "sources.iceberg-catalog",
  );
 }
 if (response.redirected && new URL(response.url).origin !== new URL(url).origin) {
  // The followed URL is catalog-controlled and could echo request detail
  // (including the token-bearing Authorization header a compromised catalog
  // received), so the error reports the declared endpoint and a fixed
  // description only (spec §4: no credentials in error details).
  throw sourceError(
   id,
   `catalog endpoint ${JSON.stringify(catalog.endpoint)} redirected to a different authority; the bearer token is never forwarded across authorities, so pin the catalog endpoint or fix its redirect`,
   "sources.iceberg-catalog-redirect",
  );
 }
 if (response.status === 401 || response.status === 403) {
  const reason = response.status === 401 ? "401 Unauthorized" : "403 Forbidden";
  throw sourceError(
   id,
   `catalog endpoint ${JSON.stringify(catalog.endpoint)} rejected the request (HTTP ${reason}); check the bearer token, the warehouse, and the table name`,
   "sources.iceberg-catalog-auth",
  );
 }
 if (!response.ok) {
  throw sourceError(
   id,
   `catalog endpoint ${JSON.stringify(catalog.endpoint)} returned HTTP ${response.status}; check the warehouse, namespace, and table`,
   "sources.iceberg-catalog",
  );
 }
 let document;
 try {
  document = await response.json();
 } catch {
  // The parser's message can quote the catalog-controlled body, which a
  // compromised catalog can fill with echoed request detail (including the
  // bearer token), so the error carries a fixed description only (spec §4).
  throw sourceError(
   id,
   `catalog endpoint ${JSON.stringify(catalog.endpoint)} returned an unreadable table response; check the catalog's REST table endpoint`,
   "sources.iceberg-catalog",
  );
 }
 const location = plainObject(document) ? document["metadata-location"] : undefined;
 if (typeof location !== "string" || !ICEBERG_METADATA_URI.test(location)) {
  throw sourceError(
   id,
   `catalog endpoint ${JSON.stringify(catalog.endpoint)} returned no versioned s3:// .metadata.json metadata-location, so no snapshot can be pinned; check the warehouse, namespace, and table`,
   "sources.iceberg-catalog",
  );
 }
 return location;
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
 if (payload?.iceberg) {
  // The pinned Iceberg reader resolves the declared versioned metadata
  // document — snapshot and delete semantics — never the raw data files
  // (LT-08; spec §2.2).
  return `iceberg_scan(${stringLiteral(name)})`;
 }
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

/** UTF-8 byte length, for the manifest size cap. */
function byteLength(text) {
 return new TextEncoder().encode(text).length;
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

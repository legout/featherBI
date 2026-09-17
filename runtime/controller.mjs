import { validateConfig } from "../contract/config.mjs";
import { createEngine } from "./bootstrap.mjs";
import { classifyLiveError } from "./sources.mjs";
import { RESULT_MAX_BYTES, RESULT_MAX_ROWS, RESULT_TIMEOUT_MS, runPlaygroundQuery, runQuery, runQueryArrow } from "./queries.mjs";
import { registerSources } from "./sources.mjs";

const CHART_LIMIT = 10_000;
const OPTION_PAGE_SIZE = 100;
const TABLE_PAGE_SIZE = 100;
let nextDashboardGeneration = 1;

/** Create one serialized dashboard runtime and publish only coherent snapshots. */
export async function createDashboard({ config, inputs, onState = () => {}, liveCredentials = null }) {
 const validation = validateConfig(config);
 if (!validation.ok) {
  throw new Error(
   `invalid dashboard config: ${validation.issues
    .map((issue) => `${issue.path || "config"}: ${issue.message}`)
    .join("; ")}`,
  );
 }
 const sourceIds = config.data.sources.map(({ id }) => id);
 const inputMap = mapInputs(config, inputs);
 const sessionCredentials = new Map();
 const priorLiveErrors = new Map();
 const live = { getCredentials: liveCredentials, sessionCredentials };
 onState({ status: "loading", error: null });
 const engine = await createEngine();
 let queue = Promise.resolve();
 let latestRevision = 0;
 let replacementPending = false;
 let disposed = false;
 let active;
 let state;
 let requestedFilterValues;
 let playgroundConnection;

 const emit = (next) => onState({ ...next });
 const enqueue = (task) => {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
 };
 const credentialSourceIds = (error) =>
  [...new Set(error?.sourceIds ?? (error?.sourceId ? [error.sourceId] : []))];
 const isCredentialFailure = (error) =>
  credentialSourceIds(error).some((sourceId) =>
   config.data.sources.some(
    ({ id, remote }) => id === sourceId && remote?.auth === "s3",
   ),
  ) &&
  classifyLiveError(error) === "credentials";
 const stageWithCredentialRetry = async (sourceInputs) => {
  try {
   return await stageGeneration(engine, config, sourceInputs, sourceIds, live, priorLiveErrors);
  } catch (error) {
   if (!isCredentialFailure(error)) throw error;
   for (const sourceId of credentialSourceIds(error)) {
    priorLiveErrors.set(sourceId, error.message);
    sessionCredentials.delete(sourceId);
   }
   return stageGeneration(engine, config, sourceInputs, sourceIds, live, priorLiveErrors);
  }
 };
 const retryLiveGeneration = async (error) => {
  if (!isCredentialFailure(error)) throw error;
  for (const sourceId of credentialSourceIds(error)) {
   priorLiveErrors.set(sourceId, error.message);
   sessionCredentials.delete(sourceId);
  }
  const previous = active;
  let candidate;
  try {
   candidate = await stageGeneration(
    engine,
    config,
    active.inputs,
    sourceIds,
    live,
    priorLiveErrors,
   );
  } catch (retryError) {
   throw liveReadError(config, retryError);
  }
  active = candidate;
  for (const sourceId of credentialSourceIds(error)) priorLiveErrors.delete(sourceId);
  await retireGeneration(engine, previous);
 };

 try {
  active = await stageWithCredentialRetry(inputMap);
  state = snapshot(active, 0, "ready");
  requestedFilterValues = { ...state.filterValues };
  playgroundConnection = config.playground ? await engine.db.connect() : null;
  emit(state);
 } catch (error) {
  await engine.dispose();
  throw error;
 }

 return {
  get state() {
   return state;
  },

  applyFilters(partial) {
   requireLive(disposed);
   const revision = ++latestRevision;
   requestedFilterValues = normalizeFilterValues(config, {
    ...requestedFilterValues,
    ...partial,
   });
   const requested = { ...requestedFilterValues };
   const prior = state;
   emit({ ...prior, status: "busy", error: null });
   return enqueue(async () => {
    if (revision !== latestRevision) return state;
    try {
     const started = performance.now();
     let batch;
     try {
      batch = await executeVisibleQueries(
       engine.connection,
       config,
       active,
       requested,
       sourceIds,
      );
     } catch (error) {
      if (!isCredentialFailure(error)) throw error;
      await retryLiveGeneration(error);
      batch = await executeVisibleQueries(
       engine.connection,
       config,
       active,
       requested,
       sourceIds,
      );
     }
     if (revision !== latestRevision) return state;
     state = {
      ...prior,
      revision,
      filterValues: requested,
      results: batch.results,
      perspectiveResults: batch.perspectiveResults,
      tablePages: batch.tablePages,
      timings: { ...prior.timings, queryMs: performance.now() - started },
      status: "ready",
      error: null,
      retained: false,
     };
     emit(state);
     return state;
    } catch (error) {
     if (revision !== latestRevision) return state;
     requestedFilterValues = { ...prior.filterValues };
     state = retainedSnapshot(prior, error);
     emit(state);
     return state;
    }
   });
  },

  setTablePage(componentId, page) {
   requireLive(disposed);
   const component = config.layout.find(
    ({ id, type }) => id === componentId && type === "table",
   );
   if (!component) throw new Error(`unknown table component ${JSON.stringify(componentId)}`);
   if (!Number.isSafeInteger(page) || page < 0) throw new Error("table page must be a non-negative integer");
   const prior = state;
   emit({ ...prior, status: "busy", error: null });
   return enqueue(async () => {
    try {
     const started = performance.now();
     let rows;
     const readPage = async () => {
      await useGeneration(engine.connection, active.schema);
      return runQuery(
       engine.connection,
       config.queries[component.query],
       state.filterValues,
       sourceIds,
       {
        limit: TABLE_PAGE_SIZE + 1,
        offset: page * TABLE_PAGE_SIZE,
        requireOrder: true,
       },
      );
     };
     try {
      rows = await readPage();
     } catch (error) {
      const annotated = annotateRemoteError(error, config, config.queries[component.query]);
      if (!isCredentialFailure(annotated)) throw annotated;
      await retryLiveGeneration(annotated);
      try {
       rows = await readPage();
      } catch (retryError) {
       throw annotateRemoteError(retryError, config, config.queries[component.query]);
      }
     }
     validateRows(rows, [component]);
     state = {
      ...state,
      status: "ready",
      error: null,
      retained: false,
      results: { ...state.results, [component.query]: rows.slice(0, TABLE_PAGE_SIZE) },
      tablePages: {
       ...state.tablePages,
       [component.id]: { page, hasNext: rows.length > TABLE_PAGE_SIZE },
      },
      timings: { ...state.timings, queryMs: performance.now() - started },
     };
     emit(state);
     return state;
    } catch (error) {
     state = retainedSnapshot(prior, error);
     emit(state);
     return state;
    }
   });
  },

  searchFilterOptions(filterId, search = "", page = 0) {
   requireLive(disposed);
   const filter = config.filters.find(
    ({ id, kind }) => id === filterId && ["select", "single-select", "multi-select", "option-search"].includes(kind),
   );
   if (!filter) throw new Error(`unknown select filter ${JSON.stringify(filterId)}`);
   if (!Number.isSafeInteger(page) || page < 0) throw new Error("option page must be a non-negative integer");
   return enqueue(async () => {
    let result;
    try {
     await useGeneration(engine.connection, active.schema);
     result = await optionPage(
      engine.connection,
      filter,
      active,
      String(search),
      page,
     );
    } catch (error) {
     const annotated = annotateRemoteError(
      error,
      config,
      { sql: `SELECT * FROM ${filter.source}` },
     );
     if (!isCredentialFailure(annotated)) throw annotated;
     await retryLiveGeneration(annotated);
     await useGeneration(engine.connection, active.schema);
     result = await optionPage(
      engine.connection,
      filter,
      active,
      String(search),
      page,
     );
    }
    state = {
     ...state,
     filterOptions: { ...state.filterOptions, [filter.id]: result.values },
     filterOptionPages: {
      ...state.filterOptionPages,
      [filter.id]: {
       search: String(search),
       page,
       hasNext: result.hasNext,
      },
     },
    };
    emit(state);
    return result;
   });
  },

  replaceFiles(replacements) {
   requireLive(disposed);
   if (replacementPending) {
    throw new Error("a source replacement is already in progress");
   }
   replacementPending = true;
   const revision = ++latestRevision;
   const prior = state;
   emit({ ...prior, status: "busy", error: null });
   return enqueue(async () => {
    let candidate = null;
    try {
     const candidateInputs = new Map(active.inputs);
     for (const [id, file] of Object.entries(replacements ?? {})) {
      const source = config.data.sources.find((entry) => entry.id === id);
      if (!source) throw new Error(`unknown replacement source ${JSON.stringify(id)}`);
      candidateInputs.set(id, { source, file });
     }
     candidate = await stageWithCredentialRetry(candidateInputs);
     if (revision !== latestRevision) {
      await retireGeneration(engine, candidate);
      return state;
     }
     const previous = active;
     active = candidate;
     state = snapshot(active, revision, "ready");
     requestedFilterValues = { ...state.filterValues };
     emit(state);
     await retireGeneration(engine, previous);
     return state;
    } catch (error) {
     if (candidate) await retireGeneration(engine, candidate);
     if (
      error?.sourceId &&
      classifyLiveError(error) === "credentials"
     ) {
      // Force a fresh prompt on the next replacement attempt.
      sessionCredentials.delete(error.sourceId);
     }
     if (revision === latestRevision) {
      state = retainedSnapshot(prior, liveReadError(config, error));
      requestedFilterValues = { ...prior.filterValues };
      emit(state);
     }
     return state;
    } finally {
     replacementPending = false;
    }
   });
  },

  runPlayground(sql, { timeoutMs = RESULT_TIMEOUT_MS } = {}) {
   requireLive(disposed);
   if (!playgroundConnection || !config.playground) throw new Error("SQL playground is not enabled");
   return enqueue(async () => {
    const run = () =>
     runPlaygroundQuery({
      connection: playgroundConnection,
      sql,
      declaredSources: sourceIds,
      models: config.playground.models,
      timeoutMs,
     });
    try {
     await useGeneration(playgroundConnection, active.schema);
     return await run();
    } catch (error) {
     const annotated = annotateRemoteError(error, config, { sql });
     if (!isCredentialFailure(annotated)) throw annotated;
     await retryLiveGeneration(annotated);
     await useGeneration(playgroundConnection, active.schema);
     return run();
    }
   });
  },

  async dispose() {
   if (disposed) return;
   disposed = true;
   await queue;
   await playgroundConnection?.close();
   await retireGeneration(engine, active);
   await engine.dispose();
  },
 };
}

async function stageGeneration(engine, config, inputs, sourceIds, live = null, priorLiveErrors = new Map()) {
 const number = nextDashboardGeneration++;
 const schema = `featherbi_gen_${number}`;
 const orderedInputs = [];
 for (const source of config.data.sources) {
  const input = inputs.get(source.id);
  if (input) {
   orderedInputs.push(input);
   continue;
  }
  if (!source.remote) {
   throw new Error(`missing input for source ${JSON.stringify(source.id)}`);
  }
  let credentials;
  if (source.remote.auth === "s3") {
   if (!live?.getCredentials) {
    throw new Error(
     `source ${JSON.stringify(source.id)} reads live and needs credentials; no credential prompt is available for this dashboard`,
    );
   }
   credentials = live.sessionCredentials.get(source.id);
   if (!credentials) {
    credentials = await live.getCredentials(
     source,
     priorLiveErrors.get(source.id) ?? null,
    );
    if (!credentials) {
     throw new Error(
      `source ${JSON.stringify(source.id)} needs credentials for the live read; enter them to load the dashboard`,
     );
    }
    live.sessionCredentials.set(source.id, credentials);
   }
  }
  orderedInputs.push({ source, credentials });
 }
 const loadStarted = performance.now();
 const registered = await registerSources(engine, orderedInputs, {
  schema,
  liveCredentials: Object.fromEntries(
   orderedInputs
    .filter(({ credentials }) => credentials)
    .map(({ source, credentials }) => [source.id, credentials]),
  ),
 });
 const generation = { number, schema, inputs, sources: registered.sources };
 try {
  const loadMs = performance.now() - loadStarted;
  const queryStarted = performance.now();
  await useGeneration(engine.connection, schema);
  const filters = await initialFilters(engine.connection, config, generation);
  const batch = await executeVisibleQueries(
   engine.connection,
   config,
   generation,
   filters.filterValues,
   sourceIds,
  );
  return {
   ...generation,
   ...filters,
   ...batch,
   timings: { loadMs, queryMs: performance.now() - queryStarted },
  };
 } catch (error) {
  await retireGeneration(engine, generation);
  throw error;
 }
}

async function initialFilters(connection, config, generation) {
 const filterValues = {};
 const filterOptions = {};
 const filterOptionPages = {};
 for (const filter of config.filters) {
   if (filter.kind === "date-range" || filter.kind === "numeric-range") {
    const range = filter.kind === "date-range"
     ? await dateDefault(connection, filter, generation)
     : { from: filter.default.from, to: filter.default.through };
   filterValues[`${filter.id}_from`] = range.from;
   filterValues[`${filter.id}_to`] = range.to;
  } else {
   filterValues[filter.id] = filter.default;
  }
  if (["select", "single-select", "multi-select", "option-search"].includes(filter.kind)) {
   const result = await optionPage(connection, filter, generation, "", 0);
   filterOptions[filter.id] = result.values;
   filterOptionPages[filter.id] = {
    search: "",
    page: 0,
    hasNext: result.hasNext,
   };
  }
 }
 return { filterValues, filterOptions, filterOptionPages };
}

async function optionPage(connection, filter, generation, search, page) {
 const source = generation.sources[filter.source].view;
 const column = identifier(filter.column);
 // Runtime-owned SQL uses quoted identifiers and prepared search values.
 let statement;
 // pi-lens-ignore: ast-grep:no-sql-in-code-js
 statement = await connection.prepare(`SELECT DISTINCT ${column} AS value FROM ${source} WHERE ${column} IS NOT NULL AND (? = '' OR CAST(${column} AS VARCHAR) ILIKE '%' || ? || '%') ORDER BY ${column} LIMIT ${OPTION_PAGE_SIZE + 1} OFFSET ${page * OPTION_PAGE_SIZE}`);
 try {
  const rows = (await statement.query(search, search)).toArray();
  return {
   values: rows.slice(0, OPTION_PAGE_SIZE).map((row) => normalizeOption(row.value)),
   hasNext: rows.length > OPTION_PAGE_SIZE,
  };
 } finally {
  await statement.close();
 }
}

async function dateDefault(connection, filter, generation) {
 if (filter.default.kind === "fixed") {
  return { from: filter.default.from, to: addDays(filter.default.through, 1) };
 }
 const source = generation.sources[filter.source].view;
 let rows;
 // pi-lens-ignore: ast-grep:no-sql-in-code-js
 rows = await connection.query(`SELECT CAST(max(CAST(${identifier(filter.column)} AS DATE)) AS VARCHAR) AS anchor FROM ${source}`);
 const anchor = rows.toArray()[0].anchor;
 if (anchor == null) return { from: null, to: null };
 const day = String(anchor);
 return { from: addDays(day, -(filter.default.days - 1)), to: addDays(day, 1) };
}

async function executeVisibleQueries(connection, config, generation, filterValues, sourceIds) {
 await useGeneration(connection, generation.schema);
 const results = {};
 const perspectiveResults = {};
 const tablePages = {};
 const componentsByQuery = new Map();
 for (const component of config.layout) {
  if (!component.query) continue;
  const components = componentsByQuery.get(component.query) ?? [];
  components.push(component);
  componentsByQuery.set(component.query, components);
 }
 for (const [queryId, components] of componentsByQuery) {
  const table = components.find(({ type }) => type === "table");
  const chart = components.some(({ type }) => isChartType(type));
  const perspective = components.some(({ type }) => type === "perspective") || (config.rendererPreset === "perspective-first" && chart);
  let rows;
  try {
   if (perspective) {
    const result = await runQueryArrow(connection, config.queries[queryId], filterValues, sourceIds, {
     limit: RESULT_MAX_ROWS + 1,
     maxBytes: RESULT_MAX_BYTES,
     timeoutMs: RESULT_TIMEOUT_MS,
    });
    rows = result.rows;
    if (rows.length > RESULT_MAX_ROWS) throw new Error(`query ${JSON.stringify(queryId)} exceeds the ${RESULT_MAX_ROWS.toLocaleString("en-US")}-row Perspective limit`);
    if (result.ipc.byteLength > RESULT_MAX_BYTES) throw new Error(`query ${JSON.stringify(queryId)} exceeds the 8 MiB Perspective Arrow limit`);
    perspectiveResults[queryId] = result.ipc;
   } else {
    rows = await runQuery(
     connection,
     config.queries[queryId],
     filterValues,
     sourceIds,
     table
      ? { limit: TABLE_PAGE_SIZE + 1, offset: 0, requireOrder: true }
      : { limit: chart ? CHART_LIMIT + 1 : 2 },
    );
   }
  } catch (error) {
   throw annotateRemoteError(error, config, config.queries[queryId]);
  }
  validateRows(rows, components);
  if (!perspective && chart && rows.length > CHART_LIMIT) {
   throw new Error(`query ${JSON.stringify(queryId)} exceeds the ${CHART_LIMIT}-row chart limit`);
  }
  if (table) {
   results[queryId] = rows.slice(0, TABLE_PAGE_SIZE);
   tablePages[table.id] = { page: 0, hasNext: rows.length > TABLE_PAGE_SIZE };
  } else {
   results[queryId] = rows;
  }
 }
 return { results, perspectiveResults, tablePages };
}

function validateRows(rows, components) {
 const fields = new Set(rows.fields ?? Object.keys(rows[0] ?? {}));
 for (const component of components) {
  const required = component.type === "kpi"
   ? [component.field]
   : component.type === "metric-group"
    ? component.fields
   : component.type === "table"
    ? component.columns.map(({ field }) => field)
   : component.type === "perspective"
    ? [...(component.perspective.groupBy ?? []), ...(component.perspective.splitBy ?? []), ...component.perspective.columns]
    : chartFields(component);
  for (const field of required) {
   if (!fields.has(field)) throw bindingError(component, `missing result field ${JSON.stringify(field)}`);
  }
  if (component.type === "kpi" || component.type === "metric-group") {
   if (rows.length !== 1) throw bindingError(component, "must return exactly one row");
   for (const field of component.type === "kpi" ? [component.field] : component.fields) {
    requireField(rows[0], field, component);
    if (!numericOrNull(rows[0][field])) throw bindingError(component, `field ${JSON.stringify(field)} must be numeric or null`);
   }
  } else if (component.type === "table") {
   for (const row of rows) {
    for (const column of component.columns) {
     requireField(row, column.field, component);
     if (!scalarOrNull(row[column.field])) {
      throw bindingError(component, `field ${JSON.stringify(column.field)} must be scalar or null`);
     }
    }
   }
  } else if (component.type === "perspective") {
   for (const row of rows) {
    for (const field of required) {
     requireField(row, field, component);
     if (!scalarOrNull(row[field])) throw bindingError(component, `field ${JSON.stringify(field)} must be scalar or null`);
    }
   }
  } else {
   const numericFields = chartNumericFields(component);
   const categoryFields = chartCategoryFields(component);
   const coordinates = new Set();
   for (const row of rows) {
    for (const field of numericFields) requireField(row, field, component);
    for (const field of categoryFields) {
     requireField(row, field, component);
     if (!scalarOrNull(row[field])) {
      throw bindingError(component, `field ${JSON.stringify(field)} must be scalar or null`);
     }
    }
    for (const field of numericFields) if (!chartNumberOrNull(row[field])) {
     throw bindingError(component, `field ${JSON.stringify(field)} must be a safe numeric value or null`);
    }
    if (component.type === "heatmap") {
     const coordinate = `${valueKey(row[component.xField ?? component.x])}\u0000${valueKey(row[component.yField ?? component.y])}`;
     if (coordinates.has(coordinate)) throw bindingError(component, "has duplicate heatmap coordinates");
     coordinates.add(coordinate);
    }
   }
  }
 }
}

function requireField(row, field, component) {
 if (!Object.hasOwn(row, field)) {
  throw bindingError(component, `missing result field ${JSON.stringify(field)}`);
 }
}

function numericOrNull(value) {
 return value == null || typeof value === "bigint" || (typeof value === "number" && Number.isFinite(value));
}

function chartNumberOrNull(value) {
 return value == null || (typeof value === "number" && Number.isFinite(value)) ||
  (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER));
}

function scalarOrNull(value) {
 return value == null || ["string", "number", "bigint", "boolean"].includes(typeof value) || value instanceof Date;
}

function valueKey(value) {
 return `${typeof value}:${value instanceof Date ? value.toISOString() : String(value)}`;
}

function normalizeOption(value) {
 if (typeof value !== "bigint") return value;
 if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
  throw new Error("integer filter option exceeds the JavaScript safe-integer range");
 }
 return Number(value);
}

function bindingError(component, message) {
 return new Error(`component ${JSON.stringify(component.id)} ${message}`);
}

function snapshot(generation, revision, status) {
 return {
  status,
  error: null,
  retained: false,
  revision,
  generation: generation.number,
  filterValues: { ...generation.filterValues },
  filterOptions: generation.filterOptions,
  filterOptionPages: generation.filterOptionPages,
  results: generation.results,
  perspectiveResults: generation.perspectiveResults,
  tablePages: generation.tablePages,
  timings: generation.timings,
 };
}

function retainedSnapshot(prior, error) {
 return {
  ...prior,
  status: "error",
  error: error instanceof Error ? error.message : String(error),
  retained: true,
 };
}

function normalizeFilterValues(config, values) {
 const normalized = {};
 for (const filter of config.filters) {
  if (filter.kind === "date-range" || filter.kind === "numeric-range") {
   normalized[`${filter.id}_from`] = values[`${filter.id}_from`] ?? null;
   normalized[`${filter.id}_to`] = values[`${filter.id}_to`] ?? null;
  } else {
   normalized[filter.id] = values[filter.id] ?? null;
  }
 }
 return normalized;
}

function isChartType(type) {
 return ["bar", "line", "area", "scatter", "pie", "donut", "heatmap", "treemap", "sankey", "gauge", "boxplot"].includes(type);
}

function chartFields(component) {
 return [...new Set([...chartCategoryFields(component), ...chartNumericFields(component)])];
}

function chartNumericFields(component) {
 if (["pie", "donut", "treemap", "sankey", "gauge", "heatmap"].includes(component.type)) return [component.value];
 if (component.type === "boxplot") return [component.min, component.q1, component.median, component.q3, component.max];
 return [component.yField ?? component.y];
}

function chartCategoryFields(component) {
 if (["pie", "donut", "treemap"].includes(component.type)) return [component.name];
 if (component.type === "sankey") return [component.source, component.target];
 if (component.type === "gauge") return [];
 if (component.type === "heatmap") return [component.xField ?? component.x, component.yField ?? component.y];
 return [component.xField ?? component.x, ...(component.series ? [component.series] : [])];
}

function mapInputs(config, inputs) {
 const result = new Map();
 for (const input of inputs ?? []) {
  const id = input.source?.id ?? input.id;
  if (id) result.set(id, input.source ? input : { source: input });
 }
 for (const source of config.data.sources) {
  // Live remote sources read their URI in the browser; no local file exists.
  if (!result.has(source.id) && !source.remote) {
   throw new Error(`missing input for source ${JSON.stringify(source.id)}`);
  }
 }
 return result;
}

/** Attach private live source IDs to DuckDB query errors for credential retry. */
function annotateRemoteError(error, config, query) {
 if (error?.sourceId || error?.sourceIds) return error;
 const sql = String(query?.sql ?? "");
 const sourceIds = config.data.sources
  .filter(({ remote }) => remote?.auth === "s3")
  .filter(({ id }) =>
   new RegExp(`\\b(?:FROM|JOIN)\\s+\\"?${id}\\"?\\b`, "i").test(sql),
  )
  .map(({ id }) => id);
 if (sourceIds.length > 0) {
  error.sourceIds = sourceIds;
  error.sourceId = sourceIds[0];
 }
 return error;
}

/** Decorate failed live reads with the source name and the actionable remedy. */
function liveReadError(config, error) {
 if (!error?.sourceId) return error;
 const source = config.data.sources.find(({ id }) => id === error.sourceId);
 if (!source?.remote) return error;
 const kind = classifyLiveError(error);
 const remedy = kind === "credentials"
  ? "the remote host rejected the credentials; if they are wrong or expired, the source will ask for them again"
  : kind === "network"
   ? "the browser could not reach the source host (a CORS block looks the same); ask the author for a packaged build or check the network"
   : "the live remote read failed; ask the author for a packaged build if it persists";
 const wrapped = new Error(
  `source ${JSON.stringify(error.sourceId)}: ${remedy} (${error.message})`,
  { cause: error },
 );
 wrapped.sourceId = error.sourceId;
 return wrapped;
}

async function retireGeneration(engine, generation) {
 if (!generation) return;
 try {
  // pi-lens-ignore: ast-grep:no-sql-in-code-js
  await engine.connection.query(`DROP SCHEMA IF EXISTS ${identifier(generation.schema)} CASCADE`);
 } catch {
  // The active snapshot has already moved; cleanup remains best effort.
 }
 for (const source of Object.values(generation.sources ?? {})) {
  try {
   await engine.db.dropFile(source.physicalName);
  } catch {
   // Failed candidates can already have removed their physical registrations.
  }
 }
}

function useGeneration(connection, schema) {
 // pi-lens-ignore: ast-grep:no-sql-in-code-js
 return connection.query(`SET search_path = ${stringLiteral(schema)}`);
}

function addDays(value, days) {
 const date = new Date(`${value}T00:00:00Z`);
 date.setUTCDate(date.getUTCDate() + days);
 return date.toISOString().slice(0, 10);
}

function identifier(value) {
 return `"${String(value).replaceAll('"', '""')}"`;
}

function stringLiteral(value) {
 return `'${String(value).replaceAll("'", "''")}'`;
}

function requireLive(disposed) {
 if (disposed) throw new Error("dashboard is disposed");
}

import { validateConfig } from "../contract/config.mjs";
import { createEngine } from "./bootstrap.mjs";
import { runQuery } from "./queries.mjs";
import { registerSources } from "./sources.mjs";

const CHART_LIMIT = 10_000;
const OPTION_PAGE_SIZE = 100;
const TABLE_PAGE_SIZE = 100;
let nextDashboardGeneration = 1;

/** Create one serialized dashboard runtime and publish only coherent snapshots. */
export async function createDashboard({ config, inputs, onState = () => {} }) {
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
 onState({ status: "loading", error: null });
 const engine = await createEngine();
 let queue = Promise.resolve();
 let latestRevision = 0;
 let replacementPending = false;
 let disposed = false;
 let active;
 let state;
 let requestedFilterValues;

 const emit = (next) => onState({ ...next });
 const enqueue = (task) => {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
 };

 try {
  active = await stageGeneration(engine, config, inputMap, sourceIds);
  state = snapshot(active, 0, "ready");
  requestedFilterValues = { ...state.filterValues };
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
     const batch = await executeVisibleQueries(
      engine.connection,
      config,
      active,
      requested,
      sourceIds,
     );
     if (revision !== latestRevision) return state;
     state = {
      ...prior,
      revision,
      filterValues: requested,
      results: batch.results,
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
     await useGeneration(engine.connection, active.schema);
     const started = performance.now();
     const rows = await runQuery(
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
    await useGeneration(engine.connection, active.schema);
    const result = await optionPage(
     engine.connection,
     filter,
     active,
     String(search),
     page,
    );
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
     candidate = await stageGeneration(engine, config, candidateInputs, sourceIds);
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
     if (revision === latestRevision) {
      state = retainedSnapshot(prior, error);
      requestedFilterValues = { ...prior.filterValues };
      emit(state);
     }
     return state;
    } finally {
     replacementPending = false;
    }
   });
  },

  async dispose() {
   if (disposed) return;
   disposed = true;
   await queue;
   await retireGeneration(engine, active);
   await engine.dispose();
  },
 };
}

async function stageGeneration(engine, config, inputs, sourceIds) {
 const number = nextDashboardGeneration++;
 const schema = `featherbi_gen_${number}`;
 const orderedInputs = config.data.sources.map(({ id }) => inputs.get(id));
 const loadStarted = performance.now();
 const registered = await registerSources(engine, orderedInputs, { schema });
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
  const chart = components.some(({ type }) => ["bar", "line", "area", "scatter", "pie", "donut", "heatmap", "treemap", "sankey", "gauge", "boxplot"].includes(type));
  const rows = await runQuery(
   connection,
   config.queries[queryId],
   filterValues,
   sourceIds,
   table
    ? { limit: TABLE_PAGE_SIZE + 1, offset: 0, requireOrder: true }
    : { limit: chart ? CHART_LIMIT + 1 : 2 },
  );
  validateRows(rows, components);
  if (chart && rows.length > CHART_LIMIT) {
   throw new Error(`query ${JSON.stringify(queryId)} exceeds the ${CHART_LIMIT}-row chart limit`);
  }
  if (table) {
   results[queryId] = rows.slice(0, TABLE_PAGE_SIZE);
   tablePages[table.id] = { page: 0, hasNext: rows.length > TABLE_PAGE_SIZE };
  } else {
   results[queryId] = rows;
  }
 }
 return { results, tablePages };
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
  if (!result.has(source.id)) {
   throw new Error(`missing input for source ${JSON.stringify(source.id)}`);
  }
 }
 return result;
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

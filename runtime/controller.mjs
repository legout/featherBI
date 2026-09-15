import { validateConfig } from "../contract/config.mjs";
import { createEngine } from "./bootstrap.mjs";
import { runQuery } from "./queries.mjs";
import { registerSources } from "./sources.mjs";

let nextDashboardGeneration = 1;

/**
 * Create one serialized dashboard runtime and publish only coherent snapshots.
 *
 * @param {object} options
 * @param {object} options.config
 * @param {Array<object>} options.inputs
 * @param {(state: object) => void} [options.onState]
 */
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
     const results = await executeVisibleQueries(
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
      results,
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
     candidate = await stageGeneration(
      engine,
      config,
      candidateInputs,
      sourceIds,
     );
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
 const registered = await registerSources(engine, orderedInputs, { schema });
 const generation = {
  number,
  schema,
  inputs,
  sources: registered.sources,
 };
 try {
  await useGeneration(engine.connection, schema);
  const { filterValues, filterOptions } = await initialFilters(
   engine.connection,
   config,
   generation,
  );
  const results = await executeVisibleQueries(
   engine.connection,
   config,
   generation,
   filterValues,
   sourceIds,
  );
  return { ...generation, filterValues, filterOptions, results };
 } catch (error) {
  await retireGeneration(engine, generation);
  throw error;
 }
}

async function initialFilters(connection, config, generation) {
 const filterValues = {};
 const filterOptions = {};
 for (const filter of config.filters) {
  if (filter.kind === "date-range") {
   const range = await dateDefault(connection, filter, generation);
   filterValues[`${filter.id}_from`] = range.from;
   filterValues[`${filter.id}_to`] = range.to;
  } else {
   filterValues[filter.id] = filter.default;
  }
  if (filter.kind === "select") {
   const source = generation.sources[filter.source].view;
   const column = identifier(filter.column);
   const table = await connection.query(
    `SELECT DISTINCT ${column} AS value FROM ${source} WHERE ${column} IS NOT NULL ORDER BY ${column} LIMIT 1000`,
   );
   filterOptions[filter.id] = table.toArray().map((row) => row.value);
  }
 }
 return { filterValues, filterOptions };
}

async function dateDefault(connection, filter, generation) {
 if (filter.default.kind === "fixed") {
  return {
   from: filter.default.from,
   to: addDays(filter.default.through, 1),
  };
 }
 const source = generation.sources[filter.source].view;
 const rows = await connection.query(
  `SELECT CAST(max(CAST(${identifier(filter.column)} AS DATE)) AS VARCHAR) AS anchor FROM ${source}`,
 );
 const anchor = rows.toArray()[0].anchor;
 if (anchor == null) return { from: null, to: null };
 const day = String(anchor);
 return {
  from: addDays(day, -(filter.default.days - 1)),
  to: addDays(day, 1),
 };
}

async function executeVisibleQueries(
 connection,
 config,
 generation,
 filterValues,
 sourceIds,
) {
 await useGeneration(connection, generation.schema);
 const results = {};
 for (const queryId of new Set(
  config.layout
   .filter(({ type }) => type === "kpi")
   .map(({ query }) => query),
 )) {
  results[queryId] = await runQuery(
   connection,
   config.queries[queryId],
   filterValues,
   sourceIds,
  );
 }
 return results;
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
  results: generation.results,
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
  if (filter.kind === "date-range") {
   normalized[`${filter.id}_from`] = values[`${filter.id}_from`] ?? null;
   normalized[`${filter.id}_to`] = values[`${filter.id}_to`] ?? null;
  } else {
   normalized[filter.id] = values[filter.id] ?? null;
  }
 }
 return normalized;
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
  await engine.connection.query(
   `DROP SCHEMA IF EXISTS ${identifier(generation.schema)} CASCADE`,
  );
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

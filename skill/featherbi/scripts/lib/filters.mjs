// Filter model, shared by build validation (Node) and the page (render inlines this file, minus `export`). Spec 0001 §Filters.
const ident = s => `"${String(s).replaceAll('"', '""')}"`;
const PLACEHOLDER = /\{\{\s*filters:\s*([A-Za-z_]\w*)(?:\s+AS\s+([A-Za-z_]\w*))?\s*\}\}/gi;
const colOf = (spec, table) => spec.cols?.[table] ?? spec.col;
// Tile `option` keys that bind chart data; rejected at build time and ignored at render time. Single source for both renderer.js and validate.mjs.
export const DATA_KEYS = ["data", "dataset", "datasetIndex", "encode", "links", "nodes", "source"];

// Pure: (sql, state, dims, date, tableColumns, exclude) -> {sql, params}. state = {dims: {name: value}, from, to}.
// Every value is a numbered parameter ($1, $2, ...) in text order.
export function expand(sql, state, dims, date, tableColumns, exclude = []) {
  const params = [];
  const bind = v => `$${params.push(v)}`;
  const out = sql.replace(PLACEHOLDER, (_, table, alias) => {
    if (!(table in tableColumns)) throw new Error(`\`{{filters:${table}}}\` names a table that is not a source`);
    const q = alias ? `${ident(alias)}.` : "";
    const has = col => tableColumns[table].includes(col);
    const preds = [];
    for (const [name, spec] of Object.entries(dims ?? {})) {
      const value = state.dims?.[name];
      if (value == null || exclude.includes(name) || !has(colOf(spec, table))) continue;
      preds.push(`${q}${ident(colOf(spec, table))} = ${bind(value)}`);
    }
    if (date && state.from && state.to && has(colOf(date, table))) {
      preds.push(`CAST(${q}${ident(colOf(date, table))} AS DATE) BETWEEN CAST(${bind(state.from)} AS DATE) AND CAST(${bind(state.to)} AS DATE)`);
    }
    return preds.length ? preds.join(" AND ") : "TRUE";
  });
  const left = out.match(/\{\{[^}]*\}\}/);
  if (left) throw new Error(`unknown placeholder ${left[0]}`);
  return { sql: out, params };
}

// Default range, anchored on the snapshot: bounds = [{min, max}] (ISO dates) of every dated table.
export function defaultRange(date, bounds) {
  const d = date?.default;
  if (d && typeof d === "object") return { from: d.from ?? null, to: d.to ?? null };
  if (!bounds.length) return { from: null, to: null };
  const min = bounds.map(b => b.min).sort()[0];
  const max = bounds.map(b => b.max).sort().at(-1);
  if (d === "all") return { from: min, to: max };
  const [y, m] = max.split("-").map(Number); // last_12_months: first day of the month 11 months before the latest date's month
  const first = new Date(Date.UTC(y, m - 12, 1));
  return { from: first.toISOString().slice(0, 10), to: max };
}

// Build side: select options and the default range. query(sql) -> rows; the snapshot is only read.
export function buildModel(config, tableColumns, query) {
  const options = {};
  for (const [name, spec] of Object.entries(config.dims ?? {})) {
    const parts = Object.keys(tableColumns).filter(t => tableColumns[t].includes(colOf(spec, t))).map(t => `SELECT ${ident(colOf(spec, t))} AS v FROM ${ident(t)}`);
    options[name] = parts.length ? query(`SELECT DISTINCT v FROM (${parts.join(" UNION ALL ")}) WHERE v IS NOT NULL ORDER BY v`).map(r => r.v) : [];
  }
  const bounds = [];
  for (const t of config.date ? Object.keys(tableColumns) : []) {
    const c = colOf(config.date, t);
    if (!tableColumns[t].includes(c)) continue;
    // `first`/`last` leave out DATE 'infinity' and '-infinity' (an open-ended validity date): they are the header line's dates.
    const d = `CAST(${ident(c)} AS DATE)`;
    const [row] = query(`SELECT min(${d})::VARCHAR AS min, max(${d})::VARCHAR AS max, (min(${d}) FILTER (WHERE isfinite(${d})))::VARCHAR AS first, (max(${d}) FILTER (WHERE isfinite(${d})))::VARCHAR AS last FROM ${ident(t)}`);
    if (row.min) bounds.push(row);
  }
  const model = { dims: config.dims ?? {}, date: config.date ?? null, tableColumns, options, range: defaultRange(config.date, bounds) };
  // The first and last real date of all dated tables, for the header line (spec 0005 §4). Not enumerable: the model is
  // embedded in the page as written, and the header line gets its dates from the template.
  const real = bounds.filter(b => b.first);
  return Object.defineProperty(model, "period", { value: real.length ? { min: real.map(b => b.first).sort()[0], max: real.map(b => b.last).sort().at(-1) } : null });
}

// URL hash (spec 0001 §Filters): `#<dim>=<value>&…&date=<from>..<to>`, dims in config order, date only when it differs from the default.
export function serializeHash(state, model) {
  const parts = Object.keys(model.dims).filter(n => state.dims[n] != null).map(n => `${encodeURIComponent(n)}=${encodeURIComponent(state.dims[n])}`);
  if (model.date && (state.from !== model.range.from || state.to !== model.range.to)) parts.push(`date=${state.from}..${state.to}`);
  return parts.length ? `#${parts.join("&")}` : "";
}

const isoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

// The hash is untrusted: a dimension must be declared and its value one of the embedded options; date needs two valid ISO dates, from <= to.
// Every part that fails is ignored. Returns the full state (defaults where the hash says nothing).
export function parseHash(hash, model) {
  const out = { dims: {}, ...model.range };
  for (const part of hash.replace(/^#/, "").split("&")) {
    try {
      const at = part.indexOf("=");
      if (at < 1) continue;
      const [name, value] = [decodeURIComponent(part.slice(0, at)), decodeURIComponent(part.slice(at + 1))];
      if (name === "date") {
        const [from, to, ...rest] = value.split("..");
        if (model.date && !rest.length && isoDate(from) && isoDate(to) && from <= to) Object.assign(out, { from, to });
      } else if (Object.hasOwn(model.dims, name)) {
        const match = model.options[name]?.find(v => String(v) === value);
        if (match !== undefined) out.dims[name] = match;
      }
    } catch {} // malformed %-encoding: this part is ignored
  }
  return out;
}

// Latest state wins: run(current) is the whole query-and-paint pass; it paints only while current() is true.
// A change during a run coalesces: when the run ends, one more run starts for the newest state only.
// change() returns a promise that settles when no newer state is left to paint.
export function latestWins(run) {
  let seq = 0;
  let loop = null;
  const drain = async () => {
    let failure;
    for (let ran = 0; ran !== seq; ) {
      const mine = (ran = seq);
      try {
        await run(() => mine === seq);
      } catch (error) {
        failure ??= error;
      }
    }
    loop = null;
    if (failure) throw failure;
  };
  return {
    change() {
      seq++;
      return (loop ??= drain());
    },
  };
}

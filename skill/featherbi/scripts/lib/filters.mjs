// Filter model, shared by build validation (Node) and the page (render inlines this file, minus `export`). Spec 0001 §Filters.
const ident = s => `"${String(s).replaceAll('"', '""')}"`;
const PLACEHOLDER = /\{\{\s*filters:\s*([A-Za-z_]\w*)(?:\s+AS\s+([A-Za-z_]\w*))?\s*\}\}/gi;
const colOf = (spec, table) => spec.cols?.[table] ?? spec.col;

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
    const [row] = query(`SELECT min(CAST(${ident(c)} AS DATE))::VARCHAR AS min, max(CAST(${ident(c)} AS DATE))::VARCHAR AS max FROM ${ident(t)}`);
    if (row.min) bounds.push(row);
  }
  return { dims: config.dims ?? {}, date: config.date ?? null, tableColumns, options, range: defaultRange(config.date, bounds) };
}

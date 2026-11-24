// featherBI renderer, inlined into every dashboard by `build` after scripts/lib/filters.mjs: engine adapter, filters, KPI tiles.
const config = JSON.parse(document.getElementById("dashboard").textContent);

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// Engine adapter: the only code that knows which browser DuckDB build runs.
// Haybarn-Wasm and upstream duckdb-wasm share one API; the bundle (module, worker, wasm)
// is assembled by hand from vendor.lock.json because Haybarn has no bundle selector.
async function startEngine({ module, worker, wasm }) {
  const duckdb = await import(module.url); // integrity: the page's import map
  const source = await (await fetch(worker.url, { integrity: worker.integrity })).text();
  const workerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl));
  // shortcut: the wasm is fetched by the worker without SRI, add it with the output modes (T9).
  await db.instantiate(wasm.url);
  URL.revokeObjectURL(workerUrl);
  // No db.open(): on Haybarn it mounts OPFS, which a file:// page is not allowed to use.
  const conn = await db.connect();
  // Without open()'s cast options BIGINT arrives as BigInt and DECIMAL as an unscaled integer.
  const plain = (value, type) => (typeof value === "bigint" ? Number(value) : value != null && type.scale != null ? value.valueOf(type.scale) : value);
  return {
    // snapshots: { <table>: Uint8Array of Parquet }
    async open(snapshots) {
      for (const [table, bytes] of Object.entries(snapshots)) {
        await db.registerFileBuffer(`${table}.parquet`, bytes);
        // pi-lens-ignore: no-sql-in-code-js
        await conn.query(`CREATE TABLE "${table}" AS FROM '${table}.parquet'`);
      }
    },
    async query(sql, params = []) {
      const statement = await conn.prepare(sql);
      try {
        const result = await statement.query(...params);
        return result.toArray().map(row => Object.fromEntries(result.schema.fields.map(f => [f.name, plain(row[f.name], f.type)])));
      } finally {
        await statement.close();
      }
    },
  };
}

const FORMATS = {
  // shortcut: currency is always US dollars, upgrade when a tile can name its currency (T5).
  currency: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
  number: new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }),
};

// Mounts a KPI tile in its loading state and returns the function that fills it.
function mountKpi(tile, index) {
  const box = el("div", "stat rounded-box bg-base-100 shadow-sm");
  const title = el("div", "stat-title text-base-content/80", tile.title);
  const value = el("div", "stat-value skeleton w-40 text-transparent tabular-nums", "0");
  title.id = `tile-${index}-title`;
  box.setAttribute("role", "group");
  box.setAttribute("aria-labelledby", title.id);
  box.setAttribute("aria-busy", "true");
  box.append(title, value);
  document.getElementById("kpis").append(box);
  return async engine => {
    let text = "–";
    try {
      const x = expand(tile.sql, state, filters.dims, filters.date, filters.tableColumns, tile.exclude);
      const [row] = engine ? await engine.query(x.sql, x.params) : []; // no engine: its own alert is already shown
      if (row?.value != null) text = (FORMATS[tile.format] ?? FORMATS.number).format(row.value);
    } finally {
      value.className = "stat-value tabular-nums";
      value.textContent = text;
      box.removeAttribute("aria-busy");
    }
  };
}

function fail(message, error) {
  console.error(error);
  document.querySelector("main").prepend(Object.assign(el("div", "alert alert-error", message), { role: "alert" }));
}

// Filter state: one value per dimension plus the date range; the default range is anchored on the snapshot.
const filters = config.filters;
const state = { dims: {}, ...filters.range };

function mountFilters(refresh) {
  const bar = document.getElementById("filters");
  const draw = () => {
    bar.replaceChildren();
    const field = (label, control) => {
      const wrap = el("label", "flex flex-col gap-1 text-xs");
      wrap.append(el("span", "text-base-content/80", label), control);
      bar.append(wrap);
    };
    for (const name of Object.keys(filters.dims)) {
      const select = el("select", "select select-sm");
      select.append(new Option("All", ""));
      for (const v of filters.options[name]) select.append(new Option(v, v));
      select.value = state.dims[name] ?? "";
      select.onchange = () => set(name, select.value === "" ? undefined : filters.options[name].find(v => String(v) === select.value));
      field(name, select);
    }
    if (filters.date) {
      for (const key of ["from", "to"]) {
        const input = el("input", "input input-sm");
        input.type = "date";
        input.value = state[key] ?? "";
        input.onchange = () => set(null, input.value || null, key);
        field(key === "from" ? "From" : "To", input);
      }
    }
    const chips = el("div", "flex flex-wrap items-center gap-2");
    chips.setAttribute("aria-label", "Active filters");
    for (const [name, value] of Object.entries(state.dims)) {
      const chip = el("span", "badge badge-neutral gap-1", `${name}: ${value}`);
      const x = el("button", "cursor-pointer", "×");
      x.setAttribute("aria-label", `Clear ${name}`);
      x.onclick = () => set(name, undefined);
      chip.append(x);
      chips.append(chip);
    }
    const reset = el("button", "btn btn-sm btn-ghost", "Reset");
    reset.onclick = () => {
      state.dims = {};
      Object.assign(state, filters.range);
      draw();
      refresh();
    };
    bar.append(chips, reset);
  };
  // A new value replaces the dimension's value; undefined clears it.
  const set = (name, value, dateKey) => {
    if (name === null) state[dateKey] = value;
    else if (value === undefined) delete state.dims[name];
    else state.dims[name] = value;
    draw();
    refresh();
  };
  draw();
}

const paint = config.tiles.map(mountKpi); // tiles first, so the layout stands while the engine loads
let engine;
try {
  engine = await startEngine(config.engine);
  const bytes = base64 => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  await engine.open(Object.fromEntries(Object.entries(config.snapshots).map(([table, b64]) => [table, bytes(b64)])));
} catch (error) {
  fail("The query engine could not be loaded from cdn.jsdelivr.net. Check your network connection, then reload this page.", error);
}
const refresh = () => Promise.all(paint.map((fill, i) => fill(engine).catch(error => fail(`Tile “${config.tiles[i].title}” could not be computed: ${error.message}`, error))));
mountFilters(refresh);
await refresh();

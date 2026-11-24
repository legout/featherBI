// featherBI renderer, inlined into every dashboard by `build` after scripts/lib/filters.mjs: engine adapter, filters, KPI, chart and text tiles.
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
  change: new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }),
};

// One tile query: the tile's SQL with the active filters expanded and bound.
function run(engine, tile, sql) {
  const x = expand(sql, state, filters.dims, filters.date, filters.tableColumns, tile.exclude);
  return engine.query(x.sql, x.params);
}

const svg = (tag, attributes, child) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (child) node.append(child);
  return node;
};

const labelled = (box, title, index) => {
  title.id = `tile-${index}-title`;
  box.setAttribute("role", "group");
  box.setAttribute("aria-labelledby", title.id);
};

// Mounts a KPI tile in its loading state and returns the function that fills it.
function mountKpi(tile, index) {
  const box = el("div", "stat rounded-box bg-base-100 shadow-sm");
  const title = el("div", "stat-title text-base-content/80", tile.title);
  const value = el("div", "stat-value skeleton w-40 text-transparent tabular-nums", "0");
  const delta = el("div", "stat-desc text-sm text-base-content/80 tabular-nums");
  labelled(box, title, index);
  box.setAttribute("aria-busy", "true");
  box.append(title, value, delta);
  const line = svg("polyline", { fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" });
  if (tile.spark) box.append(svg("svg", { class: "mt-1 h-8 w-full text-primary", viewBox: "0 0 100 24", preserveAspectRatio: "none", "aria-hidden": "true" }, line));
  document.getElementById("kpis").append(box);
  return async engine => {
    let text = "–";
    let change = "";
    let points = "";
    try {
      // no engine: its own alert is already shown
      const [[row], [base], spark] = await Promise.all([tile.sql, tile.compare, tile.spark].map(sql => (engine && sql ? run(engine, tile, sql) : [])));
      if (row?.value != null) text = (FORMATS[tile.format] ?? FORMATS.number).format(row.value);
      // Δ %: the change of `value` against `compare`; no figure when either is missing or the base is 0.
      if (row?.value != null && base?.value) change = FORMATS.change.format((row.value - base.value) / Math.abs(base.value));
      const ys = spark.map(r => r.y ?? 0);
      const low = Math.min(...ys);
      const span = Math.max(...ys) - low || 1;
      points = ys.map((y, i) => `${ys.length > 1 ? (i / (ys.length - 1)) * 100 : 50},${22 - ((y - low) / span) * 20}`).join(" ");
    } finally {
      value.className = "stat-value tabular-nums";
      value.textContent = text;
      delta.textContent = change;
      line.setAttribute("points", points);
      box.removeAttribute("aria-busy");
    }
  };
}

// A card in the tile grid: title plus a body the tile type fills.
function mountCard(tile, index, bodyClass) {
  const box = el("div", "card bg-base-100 shadow-sm");
  const inner = el("div", "card-body gap-3 p-4");
  const title = el("h2", "card-title text-sm font-medium text-base-content/80", tile.title);
  const body = el("div", bodyClass);
  labelled(box, title, index);
  inner.append(title, body);
  box.append(inner);
  document.getElementById("tiles").append(box);
  return { box, body };
}

// Chart colours come from the active DaisyUI theme. ECharts cannot blend oklch(), so a canvas resolves every colour to RGB.
const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
const resolve = (color, fallback = "#888") => {
  pixel.fillStyle = fallback; // kept when the browser cannot parse `color`
  pixel.fillStyle = color;
  pixel.fillRect(0, 0, 1, 1);
  return `rgb(${pixel.getImageData(0, 0, 1, 1).data.slice(0, 3).join(",")})`;
};
function chartTheme() {
  const css = getComputedStyle(document.documentElement);
  const token = name => css.getPropertyValue(`--color-${name}`);
  const blend = (a, percent, b) => resolve(`color-mix(in oklab, ${token(a)} ${percent}%, ${token(b)})`, token(a));
  // Series colours: the theme's hues at one lightness per scheme, so every series stands out from the surface (>= 4.5:1).
  const tone = name => resolve(`oklch(from ${token(name)} ${css.colorScheme === "dark" ? 0.75 : 0.52} max(c, 0.13) h)`, token(name));
  const [surface, text, muted, line] = [resolve(token("base-100")), resolve(token("base-content")), blend("base-content", 75, "base-100"), blend("base-content", 18, "base-100")];
  const axis = { axisLine: { lineStyle: { color: line } }, axisTick: { lineStyle: { color: line } }, axisLabel: { color: muted }, splitLine: { lineStyle: { color: line } }, nameTextStyle: { color: muted } };
  const gap = { borderColor: surface, borderWidth: 2 };
  const onFill = { color: surface }; // labels that sit on a series colour
  return {
    color: ["primary", "accent", "success", "warning", "secondary", "error", "info"].map(tone),
    backgroundColor: "transparent",
    textStyle: { color: text, fontFamily: getComputedStyle(document.body).fontFamily },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    categoryAxis: axis,
    valueAxis: axis,
    legend: { textStyle: { color: text }, top: 0 },
    tooltip: { backgroundColor: surface, borderColor: line, textStyle: { color: text } },
    visualMap: { inRange: { color: [blend("primary", 15, "base-100"), tone("primary")] }, textStyle: { color: muted } },
    calendar: { itemStyle: { color: "transparent", borderColor: line }, splitLine: { lineStyle: { color: muted } }, dayLabel: { color: muted }, monthLabel: { color: muted }, yearLabel: { color: muted } },
    candlestick: { itemStyle: { color: tone("success"), borderColor: tone("success"), color0: tone("error"), borderColor0: tone("error") } },
    boxplot: { itemStyle: { color: blend("primary", 20, "base-100"), borderColor: tone("primary") } },
    gauge: { axisLine: { lineStyle: { color: [[1, line]] } }, axisLabel: { color: muted }, detail: { color: text }, title: { color: muted } },
    heatmap: { itemStyle: gap },
    sankey: { label: { color: text }, lineStyle: { color: "gradient", opacity: 0.35 } },
    pie: { itemStyle: gap, label: { color: text } },
    funnel: { itemStyle: gap, label: onFill },
    treemap: { itemStyle: { borderColor: surface, gapWidth: 2 }, label: onFill },
    sunburst: { itemStyle: gap, label: onFill },
  };
}

// Data bindings of a preset: "@name" or "@name:column" strings in its option are replaced by values from the tile's rows.
const BIND = {
  rows: rows => rows,
  uniq: (rows, col) => [...new Set(rows.map(r => r[col]))],
  min: (rows, col) => rows.reduce((m, r) => (m == null || r[col] < m ? r[col] : m), null),
  max: (rows, col) => rows.reduce((m, r) => (m == null || r[col] > m ? r[col] : m), null),
  // sankey nodes: every distinct value of the listed columns
  names: (rows, cols) => [...new Set(cols.split(",").flatMap(col => rows.map(r => r[col])))].map(name => ({ name })),
  // waterfall: each change `y` becomes a floating bar from the running total before it to the one after it
  steps: rows => {
    let end = 0;
    return rows.map(r => {
      const start = end;
      end += r.y;
      return { ...r, start, end, low: Math.min(start, end), high: Math.max(start, end) };
    });
  },
};
const bind = (node, rows) => {
  if (typeof node === "string" && node[0] === "@") return BIND[node.slice(1).split(":")[0]](rows, node.split(":")[1]);
  if (Array.isArray(node)) return node.map(n => bind(n, rows));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, bind(v, rows)]));
  return node;
};
// A tile `option` restyles the preset: objects merge key by key, arrays item by item. Keys that bind data are ignored, so data comes from the preset only.
const DATA_KEYS = ["data", "dataset", "datasetIndex", "encode", "links", "nodes", "source"];
const restyle = (base, over) => {
  if (!over || typeof over !== "object" || !base || typeof base !== "object") return over === undefined ? base : over;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) if (!DATA_KEYS.includes(k)) out[k] = restyle(base[k], v);
  return out;
};

// The ECharts option of a chart tile: the preset with its data bound, restyled by the tile's `option`.
function chartOption(tile, preset, rows) {
  const format = FORMATS[tile.format] ?? FORMATS.number;
  const option = restyle({ aria: { enabled: true }, animation: !matchMedia("(prefers-reduced-motion: reduce)").matches, ...bind(preset.option, rows) }, tile.option);
  if (option.tooltip) option.tooltip = { confine: true, valueFormatter: v => (typeof v === "number" ? format.format(v) : v), ...option.tooltip };
  // A `series` column splits the preset's one series into one per value, each over its own rows.
  if (rows[0].series !== undefined && [...preset.columns, ...preset.optional].includes("series")) {
    const names = BIND.uniq(rows, "series");
    option.dataset = names.map(name => ({ ...option.dataset, source: rows.filter(r => r.series === name) }));
    option.series = names.map((name, datasetIndex) => ({ ...option.series[0], name: String(name), datasetIndex }));
  }
  for (const series of option.series) series.cursor = tile.click && preset.click.length ? "pointer" : "default";
  return option;
}

let echarts; // the chart library, loaded once when the dashboard has a chart tile
const charts = [];

// Mounts a chart tile in its loading state and returns the function that draws it from its rows.
function mountChart(tile, index) {
  const { box, body } = mountCard(tile, index, "skeleton relative h-80");
  const preset = config.presets[tile.preset];
  const empty = el("p", "absolute inset-0 grid place-items-center text-sm text-base-content/80", "No data for the current filters.");
  empty.hidden = true;
  box.setAttribute("aria-busy", "true");
  let chart;
  const start = () => {
    const node = el("div", "size-full");
    body.append(node, empty);
    chart = echarts.init(node, chartTheme());
    charts.push(chart);
    new ResizeObserver(() => chart.resize()).observe(node);
    // A click sets the clicked element's key columns as the tile's click dimensions; the same click again clears them.
    chart.on("click", p => {
      const dims = [].concat(tile.click ?? []).slice(0, preset.click.length);
      const values = dims.map((_, i) => p.data?.[preset.click[i]]);
      if (!dims.length || values.some(v => v == null)) return;
      const same = dims.every((dim, i) => state.dims[dim] === values[i]);
      dims.forEach((dim, i) => (same ? delete state.dims[dim] : (state.dims[dim] = values[i])));
      drawFilters();
      refresh();
    });
  };
  return async engine => {
    try {
      if (!engine || !echarts) return; // their own alerts are already shown
      const rows = await run(engine, tile, tile.sql);
      if (!chart) start();
      empty.hidden = rows.length > 0;
      if (rows.length) chart.setOption(chartOption(tile, preset, rows), true);
      else chart.clear();
    } finally {
      body.classList.remove("skeleton");
      box.removeAttribute("aria-busy");
    }
  };
}

// Text tiles take a small Markdown subset: #, ## and ### headings, paragraphs, "- " lists, **bold**, *italic* and [label](http(s) link).
// Everything else stays literal text; every node is built from text, never from HTML.
const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
function inline(parent, text) {
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    const node = m[1] != null ? el("strong", "font-semibold", m[1]) : m[2] != null ? el("em", "", m[2]) : Object.assign(el("a", "link", m[3]), { href: m[4], target: "_blank", rel: "noopener" });
    parent.append(text.slice(at, m.index), node);
    at = m.index + m[0].length;
  }
  parent.append(text.slice(at));
}
function mountText(tile, index) {
  const { body } = mountCard(tile, index, "max-w-prose space-y-2 text-sm leading-relaxed");
  const flat = s => s.trim().replace(/\s*\n\s*/g, " ");
  for (const block of String(tile.markdown ?? "").trim().split(/\n\s*\n/)) {
    const heading = block.match(/^(#{1,3}) +(.*)$/s);
    if (heading) inline(body.appendChild(el(`h${heading[1].length + 2}`, "text-base font-semibold text-base-content")), flat(heading[2]));
    else if (block.startsWith("- ")) {
      const list = body.appendChild(el("ul", "list-disc space-y-1 pl-5"));
      for (const item of block.split(/^- /m).slice(1)) inline(list.appendChild(el("li", "")), flat(item));
    } else inline(body.appendChild(el("p", "")), flat(block));
  }
  return async () => {};
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
  return draw;
}

// Tiles first, so the layout stands while the engine loads. Pivot and table tiles are not rendered yet.
const MOUNT = { kpi: mountKpi, echarts: mountChart, text: mountText };
const paint = config.tiles.map((tile, i) => MOUNT[tile.type]?.(tile, i) ?? (async () => {}));
const library = config.tiles.some(t => t.type === "echarts") ? import(config.charts.url) : null; // integrity: the page's import map
library?.catch(() => {}); // reported below, once the engine has had its turn
let engine;
try {
  engine = await startEngine(config.engine);
  const bytes = base64 => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  await engine.open(Object.fromEntries(Object.entries(config.snapshots).map(([table, b64]) => [table, bytes(b64)])));
} catch (error) {
  fail("The query engine could not be loaded from cdn.jsdelivr.net. Check your network connection, then reload this page.", error);
}
try {
  echarts = await library;
} catch (error) {
  fail("The chart library could not be loaded from cdn.jsdelivr.net. Check your network connection, then reload this page.", error);
}
document.getElementById("theme").addEventListener("change", () => {
  const theme = chartTheme();
  for (const chart of charts) chart.setTheme(theme);
});
const refresh = () => Promise.all(paint.map((fill, i) => fill(engine).catch(error => fail(`Tile “${config.tiles[i].title}” could not be computed: ${error.message}`, error))));
const drawFilters = mountFilters(refresh);
await refresh();

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
async function startEngine({ module, worker, wasm, extensions = {} }) {
  const duckdb = await import(module.url); // integrity: the page's import map
  // Haybarn reads Parquet through its parquet extension, which its worker would otherwise download without a hash at the
  // first query. The page supplies the pinned copy instead (default: fetched with its hash; offline: inlined): the worker's
  // own prefetchExtensions() fetches it from this shim and the engine loads it from that store, whatever the network.
  const base64 = async entry => {
    const bytes = await (await fetch(entry.data ?? entry.url, { integrity: entry.integrity })).arrayBuffer();
    const url = await new Promise(resolve => Object.assign(new FileReader(), { onload: e => resolve(e.target.result) }).readAsDataURL(new Blob([bytes])));
    return url.slice(url.indexOf(",") + 1);
  };
  const [text, ...pinned] = await Promise.all([fetch(worker.url, { integrity: worker.integrity }).then(r => r.text()), ...Object.values(extensions).map(base64)]);
  // The worker fetches the wasm itself, so its hash rides on the Request the worker builds (a no-op if a bundle no longer has that line).
  // (The directive keeps the bundle strict: it must stay the first statement of the worker script.)
  const shim = `"use strict";
const __fbExt = ${JSON.stringify(Object.fromEntries(Object.values(extensions).map((entry, i) => [entry.url, pinned[i]])))}, __fbFetch = fetch;
self.fetch = (url, init) => __fbExt[url] ? Promise.resolve(new Response(Uint8Array.from(atob(__fbExt[url]), c => c.charCodeAt(0)), { status: 200, headers: { "content-type": "application/wasm" } })) : __fbFetch(url, init);
`;
  const source = shim + text.replaceAll("new Request(this.mainModuleURL)", `new Request(this.mainModuleURL,{integrity:${JSON.stringify(wasm.integrity)}})`);
  const workerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl));
  // The wasm by URL: the CDN in a default build, a data: URL in an offline one (the build verified those bytes, so no hash is left to check).
  await db.instantiate(wasm.url);
  URL.revokeObjectURL(workerUrl);
  // No db.open(): on Haybarn it mounts OPFS, which a file:// page is not allowed to use.
  const conn = await db.connect();
  const names = Object.keys(extensions);
  if (names.length && (await db.prefetchExtensions(names)).length !== names.length) throw new Error("the Parquet extension could not be loaded");
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
    // The raw Arrow result, for Explore: Perspective keeps the column types (dates, decimals).
    async arrow(sql, params = []) {
      const statement = await conn.prepare(sql);
      try {
        return await statement.query(...params);
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
  return async (engine, current) => {
    let text = "–";
    let change = "";
    let points = "";
    try {
      // no engine: its own alert is already shown
      const [[row], [base], spark] = await Promise.all([tile.sql, tile.compare, tile.spark].map(sql => (engine && sql ? run(engine, tile, sql) : [])));
      if (row?.value != null) text = (FORMATS[tile.format] ?? FORMATS.number).format(row.value);
      // Δ %: the change of `value` against `compare`; no figure when either is missing or the base is 0.
      if (row?.value != null && base?.value) change = FORMATS.change.format((row.value - base.value) / Math.abs(base.value));
      if (!current()) return; // an older state's result is never painted
      const ys = spark.map(r => r.y ?? 0);
      const low = Math.min(...ys);
      const span = Math.max(...ys) - low || 1;
      points = ys.map((y, i) => `${ys.length > 1 ? (i / (ys.length - 1)) * 100 : 50},${22 - ((y - low) / span) * 20}`).join(" ");
    } finally {
      if (current()) {
        value.className = "stat-value tabular-nums";
        value.textContent = text;
        delta.textContent = change;
        line.setAttribute("points", points);
        box.removeAttribute("aria-busy");
      }
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
    custom: { itemStyle: gap },
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
  // pareto: rows sorted by `y`, largest first, each with `share`, the running total in % of the grand total
  pareto: rows => {
    const total = rows.reduce((sum, r) => sum + r.y, 0);
    let sum = 0;
    return [...rows].sort((a, b) => b.y - a.y).map(r => ({ ...r, share: (100 * (sum += r.y)) / total }));
  },
  // histogram: one rectangle per row, from `lo` to `hi` on the value axis and `count` high
  bins: () => (_, api) => {
    const [x, y] = api.coord([api.value("lo"), api.value("count")]);
    const [right, bottom] = api.coord([api.value("hi"), 0]);
    return { type: "rect", shape: { x, y, width: right - x, height: bottom - y }, style: api.style() };
  },
  // timeline: one bar per row, from `start` to `end` on the time axis, in the band of its `name`
  spans: () => (_, api) => {
    const [x, y] = api.coord([api.value("start"), api.value("name")]);
    const height = Math.min(api.size([0, 1])[1] * 0.6, 32);
    return { type: "rect", shape: { x, y: y - height / 2, width: api.coord([api.value("end"), api.value("name")])[0] - x, height }, style: api.style() };
  },
  // Tooltips of the two as text nodes, so data is never read as HTML: "150 – 200: 3" and "M1 · run: 2025-01-06 08:00 – 2025-01-06 12:00" (UTC, like the axis).
  bin: () => p => el("span", "", `${FORMATS.number.format(p.data.lo)} – ${FORMATS.number.format(p.data.hi)}: ${FORMATS.number.format(p.data.count)}`),
  span: () => p => {
    const time = v => new Date(v).toISOString().slice(0, 16).replace("T", " ");
    return el("span", "", `${[p.data.name, p.data.state].filter(v => v != null).join(" · ")}: ${time(p.data.start)} – ${time(p.data.end)}`);
  },
};
const bind = (node, rows) => {
  if (typeof node === "string" && node[0] === "@") return BIND[node.slice(1).split(":")[0]](rows, node.split(":")[1]);
  if (Array.isArray(node)) return node.map(n => bind(n, rows));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, bind(v, rows)]));
  return node;
};
// A tile `option` restyles the preset: objects merge key by key, arrays item by item. Keys that bind data are ignored, so data comes from the preset only.
// DATA_KEYS comes from filters.mjs, inlined just above.
const restyle = (base, over, skip = DATA_KEYS) => {
  if (!over || typeof over !== "object" || !base || typeof base !== "object") return over === undefined ? base : over;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) if (!skip.includes(k)) out[k] = restyle(base[k], v, skip);
  return out;
};

// The ECharts option of a chart tile: the preset with its data bound, restyled by the tile's `option`.
function chartOption(tile, preset, rows) {
  const format = FORMATS[tile.format] ?? FORMATS.number;
  // A preset's `with.<column>` part joins its option only when the rows have that optional column (candlestick volume).
  const template = Object.entries(preset.with ?? {}).reduce((o, [column, part]) => (rows[0][column] === undefined ? o : restyle(o, part, [])), preset.option);
  const option = restyle({ aria: { enabled: true }, animation: !matchMedia("(prefers-reduced-motion: reduce)").matches, ...bind(template, rows) }, tile.option);
  if (option.tooltip) option.tooltip = { confine: true, valueFormatter: v => (typeof v === "number" ? format.format(v) : v), ...option.tooltip };
  // A `series` column (timeline: `state`) splits the preset's one series into one per value, each over its own rows.
  const by = preset.split ?? "series";
  if (rows[0][by] !== undefined && [...preset.columns, ...preset.optional].includes(by)) {
    const names = BIND.uniq(rows, by);
    option.dataset = names.map(name => ({ ...option.dataset, source: rows.filter(r => r[by] === name) }));
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
  return async (engine, current) => {
    try {
      if (!engine || !echarts) return; // their own alerts are already shown
      const rows = await run(engine, tile, tile.sql);
      if (!current()) return; // an older state's result is never painted
      if (!chart) start();
      empty.hidden = rows.length > 0;
      if (rows.length) chart.setOption(chartOption(tile, preset, rows), true);
      else chart.clear();
    } finally {
      if (current()) {
        body.classList.remove("skeleton");
        box.removeAttribute("aria-busy");
      }
    }
  };
}

// Pivot totals arrive from SQL as r_total/c_total markers; the renderer only lays them out.
function mountPivot(tile, index) {
  const { box, body } = mountCard(tile, index, "w-full text-sm");
  body.style.overflowX = "auto";
  box.setAttribute("aria-busy", "true");
  return async (engine, current) => {
    try {
      if (!engine) return;
      const rows = await run(engine, tile, tile.sql);
      if (!current()) return;
      body.replaceChildren();
      if (!rows.length) {
        body.append(el("p", "text-base-content/80", "No data for the current filters."));
        return;
      }
      const format = FORMATS[tile.format] ?? FORMATS.number;
      const columns = [];
      const seenColumns = new Set();
      const byRow = new Map();
      for (const row of rows) {
        if (!byRow.has(row.r)) byRow.set(row.r, { total: false, cells: new Map() });
        const entry = byRow.get(row.r);
        entry.total ||= Boolean(row.r_total);
        entry.cells.set(row.c, row.v);
        if (!seenColumns.has(row.c)) {
          seenColumns.add(row.c);
          columns.push({ value: row.c, total: Boolean(row.c_total) });
        }
      }
      columns.sort((a, b) => Number(a.total) - Number(b.total));
      const entries = [...byRow.entries()].sort((a, b) => Number(a[1].total) - Number(b[1].total));
      const table = el("table", "table w-full");
      const head = table.appendChild(el("thead", ""));
      const header = head.appendChild(el("tr", ""));
      header.append(el("th", "font-semibold", tile.click ?? ""));
      for (const column of columns) {
        const cell = el("th", column.total ? "font-semibold bg-base-200" : "font-semibold", column.value);
        cell.scope = "col";
        cell.style.textAlign = "right";
        cell.style.whiteSpace = "nowrap";
        header.append(cell);
      }
      const tbody = table.appendChild(el("tbody", ""));
      for (const [label, entry] of entries) {
        const tr = tbody.appendChild(el("tr", entry.total ? "font-semibold bg-base-200" : ""));
        const th = el("th", entry.total ? "font-semibold" : "font-medium");
        th.scope = "row";
        if (tile.click && !entry.total) {
          const button = el("button", "link cursor-pointer", label);
          button.type = "button";
          button.onclick = () => {
            if (state.dims[tile.click] === label) delete state.dims[tile.click];
            else state.dims[tile.click] = label;
            drawFilters();
            refresh();
          };
          th.append(button);
        } else th.textContent = label;
        tr.append(th);
        for (const column of columns) {
          const value = entry.cells.get(column.value);
          const td = el("td", column.total ? "font-semibold bg-base-200" : "", value == null ? "–" : format.format(value));
          td.style.textAlign = "right";
          td.style.whiteSpace = "nowrap";
          tr.append(td);
        }
      }
      body.append(table);
    } finally {
      if (current()) {
        box.removeAttribute("aria-busy");
      }
    }
  };
}

let agGrid;
const gridBodies = [];

function gridTheme(body) {
  const dark = document.getElementById("theme").checked;
  body.classList.toggle("ag-theme-quartz", !dark);
  body.classList.toggle("ag-theme-quartz-dark", dark);
}

function loadGrid({ url, integrity }) {
  return new Promise((resolve, reject) => {
    const script = el("script", "");
    script.src = url;
    script.integrity = integrity;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve(window.agGrid);
    script.onerror = () => reject(new Error("AG Grid failed to load"));
    document.head.append(script);
  });
}

// AG Grid owns scrolling and sorting; every block is a filtered SQL page with __row as its stable tie-breaker.
function mountTable(tile, index) {
  const { box, body } = mountCard(tile, index, "h-80 w-full");
  gridBodies.push(body);
  gridTheme(body);
  box.setAttribute("aria-busy", "true");
  let api;
  const source = (engine, current, count) => ({
    async getRows(params) {
      try {
        const selected = ["__row", ...tile.columns].map(ident).join(", ");
        const sql = `SELECT ${selected} FROM ${ident(tile.source)} WHERE {{filters:${tile.source}}}`;
        const x = expand(sql, state, filters.dims, filters.date, filters.tableColumns, tile.exclude);
        const sort = params.sortModel.map(({ colId, sort }) => `${ident(colId)} ${sort.toUpperCase()}`);
        sort.push(ident("__row"));
        // pi-lens-ignore: no-sql-in-code-js
        const rows = await engine.query(`${x.sql} ORDER BY ${sort.join(", ")} LIMIT ? OFFSET ?`, [
          ...x.params,
          params.endRow - params.startRow,
          params.startRow,
        ]);
        if (!current()) return params.failCallback();
        params.successCallback(rows, count);
      } catch (error) {
        params.failCallback();
        if (current()) fail(`Tile “${tile.title}” could not be computed: ${error.message}`, error);
      }
    },
  });
  return async (engine, current) => {
    try {
      if (!engine || !agGrid) return;
      const countSql = `SELECT COUNT(*) AS n FROM ${ident(tile.source)} WHERE {{filters:${tile.source}}}`;
      const [row] = await run(engine, tile, countSql);
      if (!current()) return;
      const count = Number(row.n);
      box.querySelector("h2").textContent = `${tile.title} · ${count} rows (filtered)`;
      const dateColumn = filters.date && (filters.date.cols?.[tile.source] ?? filters.date.col);
      const options = {
        theme: "legacy",
        columnDefs: tile.columns.map(field => ({
          field,
          headerName: field,
          valueFormatter: field === dateColumn ? params => params.value == null ? "" : new Date(params.value).toISOString().slice(0, 10) : undefined,
        })),
        defaultColDef: { sortable: true, resizable: true, flex: 1, minWidth: 100 },
        rowModelType: "infinite",
        cacheBlockSize: 5,
        maxBlocksInCache: 3,
        datasource: source(engine, current, count),
        getRowId: params => String(params.data.__row),
        animateRows: false,
      };
      if (api) api.setGridOption("datasource", options.datasource);
      else api = agGrid.createGrid(body, options);
    } finally {
      if (current()) box.removeAttribute("aria-busy");
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

// Remote snapshot (spec 0002): every table is downloaded whole, in parallel, under one progress bar.
// -> { <table>: Uint8Array } without the tables that failed (each reported by name), or null when a 403 says the links have expired.
async function download(remote) {
  const mb = bytes => (bytes / 2 ** 20).toFixed(1);
  const total = Object.values(remote.tables).reduce((sum, t) => sum + t.bytes, 0);
  let done = 0;
  let expired = false;
  const box = el("div", "space-y-1");
  const label = el("p", "text-sm text-base-content/80 tabular-nums");
  const bar = el("progress", "progress progress-primary w-full");
  bar.max = total;
  bar.setAttribute("aria-label", "Loading data");
  const show = () => {
    label.textContent = `Loading data ${mb(done)} / ${mb(total)} MB`;
    bar.value = done;
  };
  show();
  box.append(label, bar);
  document.querySelector("main").prepend(box);
  const tables = {};
  await Promise.all(Object.entries(remote.tables).map(async ([table, { url }]) => {
    let status = "network or CORS error";
    try {
      const response = await fetch(url);
      status = `HTTP ${response.status}`;
      if (response.status === 403) expired = true; // S3 answers an expired signature with 403
      if (!response.ok) throw new Error(status);
      const chunks = [];
      const reader = response.body.getReader();
      for (let part = await reader.read(); !part.done; part = await reader.read()) {
        chunks.push(part.value);
        done += part.value.length;
        show();
      }
      tables[table] = new Uint8Array(await new Blob(chunks).arrayBuffer());
    } catch (error) {
      if (!expired) fail(`Table “${table}” could not be loaded (${status}). Tiles that use it show an error.`, error);
    }
  }));
  box.remove();
  return expired ? null : tables;
}

// Filter state: one value per dimension plus the date range; the default range is anchored on the snapshot.
const filters = config.filters;
const state = { dims: {}, ...filters.range };
Object.assign(state, parseHash(location.hash, filters)); // untrusted: only the valid parts apply

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

// Tiles first, so the layout stands while the engine loads.
const MOUNT = { kpi: mountKpi, echarts: mountChart, pivot: mountPivot, table: mountTable, text: mountText };
const paint = config.tiles.map((tile, i) => MOUNT[tile.type]?.(tile, i) ?? (async () => {}));
const library = config.tiles.some(t => t.type === "echarts") ? import(config.charts.url) : null; // integrity: the page's import map
const gridLibrary = config.tiles.some(t => t.type === "table") ? loadGrid(config.grid) : null;
library?.catch(() => {}); // reported below, once the engine has had its turn
gridLibrary?.catch(() => {});
// A remote page past its expiry (the viewer's clock) loads nothing; otherwise its download runs while the engine starts.
const EXPIRED = "This dashboard's data link has expired. Ask the author to rebuild it.";
const remote = config.remote;
let expired = remote && Date.now() >= Date.parse(remote.expiresAt);
const until = remote && !expired ? el("p", "px-3 text-right text-xs text-base-content/80", `Data available until ${new Date(remote.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`) : null;
if (until) document.querySelector("header h1").after(until);
const downloaded = until && download(remote);
let engine;
try {
  if (!expired) engine = await startEngine(config.engine);
} catch (error) {
  fail("The query engine could not be loaded from cdn.jsdelivr.net. Check your network connection, then reload this page.", error);
}
const remoteTables = await downloaded;
if (remote && !remoteTables) {
  // Expired: the layout and the filter bar stay, and without an engine no tile runs a query.
  expired = true;
  engine = undefined;
  until?.remove();
  document.querySelector("main").prepend(Object.assign(el("div", "alert alert-warning", EXPIRED), { role: "alert" }));
}
// Each snapshot is a data: URL (embedded), a Parquet file next to the page (--split) or a downloaded remote table.
const tables = { ...remoteTables };
try {
  for (const [table, url] of Object.entries(config.snapshots ?? {})) tables[table] = new Uint8Array(await (await fetch(url)).arrayBuffer());
  await engine?.open(tables);
} catch (error) {
  fail("The snapshot could not be loaded. Check your network connection, then reload this page. (A --split dashboard is served by a web server such as python3 -m http.server; it does not open from file://.)", error);
}
try {
  echarts = await library;
} catch (error) {
  fail("The chart library could not be loaded from cdn.jsdelivr.net. Check your network connection, then reload this page.", error);
}
try {
  agGrid = await gridLibrary;
} catch (error) {
  fail("The table library could not be loaded from cdn.jsdelivr.net. Check your network connection, then reload this page.", error);
}
document.getElementById("theme").addEventListener("change", () => {
  const theme = chartTheme();
  for (const chart of charts) chart.setTheme(theme);
  for (const body of gridBodies) gridTheme(body);
});
// Latest state wins: every change is a new pass; passes paint only while they are the newest, and changes during a pass coalesce.
const pass = latestWins(current => Promise.all(paint.map((fill, i) => fill(engine, current).catch(error => fail(`Tile “${config.tiles[i].title}” could not be computed: ${error.message}`, error)))));
const refresh = () => {
  history.replaceState(null, "", serializeHash(state, filters) || location.pathname + location.search); // no history entry per change
  return pass.change();
};
const drawFilters = mountFilters(refresh);
addEventListener("hashchange", () => {
  state.dims = {};
  Object.assign(state, filters.range, parseHash(location.hash, filters));
  drawFilters();
  refresh();
});
await refresh();

// Explore (spec 0001 §Explore): a navbar button opens Perspective on one table. Perspective loads on the first open only;
// each open loads the table with the filters active at that moment, and the filter path never touches it.
if (config.explore && !expired) {
  const { table: name, perspective: psp, charts, assets } = config.explore;
  const button = el("button", "btn btn-sm btn-ghost", "Explore");
  const dialog = el("dialog", "rounded-box bg-base-100 shadow-sm");
  dialog.setAttribute("aria-label", `Explore ${name}`);
  dialog.style.cssText = "width:95vw;height:90vh;max-width:none;max-height:none;margin:auto;padding:0"; // preflight drops the dialog's centring
  const close = el("button", "btn btn-sm btn-ghost", "Close");
  close.onclick = () => dialog.close();
  const head = el("div", "flex items-center gap-3 px-4");
  head.append(el("h2", "flex-1 text-sm font-semibold", `Explore: ${name}`), close);
  dialog.append(head);
  document.body.append(dialog);
  document.querySelector("header h1").after(button);
  let ready; // the loaded viewer and its Perspective table, created on the first open
  const load = async () => {
    // shortcut: a default build leaves the Perspective client and viewer fetching their wasm from the CDN without SRI (tools/patch-perspective.mjs patches the charts plugin only); --offline inlines it and patches those fetches to a name.
    if (assets) window.__fbAsset = name => assets[name]; // a data: URL; the patched bundle's own fetch() loads it
    const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: psp.css.url, integrity: psp.css.integrity, crossOrigin: "anonymous" });
    document.head.append(css);
    // integrity: the page's import map. The charts plugin is the patched bundle inlined by the build (tools/patch-perspective.mjs).
    await import(psp.viewer.url);
    await Promise.all([import(psp.datagrid.url), import(`data:text/javascript;charset=utf-8,${encodeURIComponent(charts)}`)]);
    const client = await (await import(psp.client.url)).default.worker();
    const viewer = document.createElement("perspective-viewer");
    viewer.style.cssText = "height:calc(100% - 3rem)";
    dialog.append(viewer);
    return { client, viewer, table: null };
  };
  button.onclick = async () => {
    button.disabled = true;
    try {
      dialog.showModal();
      ready ??= load();
      const p = await ready;
      p.viewer.style.visibility = "hidden"; // the previous open's rows stay hidden until this open's view is drawn; laid out, so the grid redraws
      const x = expand(`SELECT * FROM ${ident(name)} WHERE {{filters:${name}}}`, state, filters.dims, filters.date, filters.tableColumns);
      const { tableToIPC } = await import("apache-arrow");
      const ipc = tableToIPC(await engine.arrow(x.sql, x.params), "stream");
      p.viewer.setAttribute("theme", document.getElementById("theme").checked ? "Pro Dark" : "Pro");
      if (p.table) await p.table.replace(ipc);
      else {
        p.table = await p.client.table(ipc, { name });
        await p.viewer.load(p.client);
        await p.viewer.restore({ table: name });
      }
      await p.viewer.flush();
      await p.viewer.resize(); // flush() resolves before the grid repaints; an awaited redraw does not
      p.viewer.style.visibility = "visible";
    } catch (error) {
      ready = undefined;
      dialog.close();
      fail("Explore could not be loaded from cdn.jsdelivr.net. Check your network connection, then try again.", error);
    } finally {
      button.disabled = false;
    }
  };
}

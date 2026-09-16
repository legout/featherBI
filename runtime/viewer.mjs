import * as echarts from "echarts";
import { createDashboard } from "./controller.mjs";

const charts = new WeakMap();
const debounceTimers = new Map();

/** Mount the fixed grid viewer for one validated dashboard config. */
export async function mountDashboard({ config, inputs, root = document }) {
 root.title = config.title;
 root.querySelector("#dashboard-title").textContent = config.title;
 const filters = root.querySelector("#dashboard-filters");
 const sources = root.querySelector("#dashboard-sources");
 const layout = root.querySelector("#dashboard-layout");
 buildFilters(filters, config.filters);
 buildSources(sources, config.data.sources);
 buildLayout(layout, config.layout);

 let controller;
 const render = (state) => renderState(root, config, state);
 const start = async (assignments) => {
  try {
   controller = await createDashboard({ config, inputs: assignments, onState: render });
   root.querySelector("#replace-files").textContent = "Replace selected files";
   return controller;
  } catch (error) {
   render({
    status: "error",
    error: error instanceof Error ? error.message : String(error),
   });
   throw error;
  }
 };

 filters.addEventListener("input", (event) => {
  if (!controller) return;
  const control = event.target;
  const textFilter = config.filters.find(
   ({ id, kind }) => kind === "text" && control.id === `filter-${id}`,
  );
  if (textFilter) {
   root.querySelector(`#filter-${textFilter.id}-all`).checked = false;
   debounce(`filter:${textFilter.id}`, () =>
    controller.applyFilters(readFilters(root, config.filters)),
   );
   return;
  }
  const textAllFilter = config.filters.find(
   ({ id, kind }) => kind === "text" && control.id === `filter-${id}-all`,
  );
  if (textAllFilter) {
   debounce(`filter:${textAllFilter.id}`, () =>
    controller.applyFilters(readFilters(root, config.filters)),
   );
   return;
  }
  const optionFilter = config.filters.find(
   ({ id, kind }) => kind === "select" && control.id === `filter-${id}-search`,
  );
  if (optionFilter) {
   debounce(`options:${optionFilter.id}`, () =>
    controller.searchFilterOptions(optionFilter.id, control.value, 0),
   );
  }
 });

 filters.addEventListener("click", async (event) => {
  if (!controller) return;
  const action = event.target.dataset.optionPage;
  const id = event.target.dataset.filterId;
  if (!action || !id) return;
  const current = controller.state.filterOptionPages[id];
  const page = action === "next" ? current.page + 1 : Math.max(0, current.page - 1);
  await controller.searchFilterOptions(id, current.search, page);
 });

 layout.addEventListener("click", async (event) => {
  if (!controller) return;
  const action = event.target.dataset.pageAction;
  const id = event.target.dataset.componentId;
  if (!action || !id) return;
  const current = controller.state.tablePages[id]?.page ?? 0;
  await controller.setTablePage(id, action === "next" ? current + 1 : Math.max(0, current - 1));
 });

 root.querySelector("#apply-filters").addEventListener("click", async () => {
  if (controller) await controller.applyFilters(readFilters(root, config.filters));
 });
 root.querySelector("#replace-files").addEventListener("click", async () => {
  const replacements = selectedFiles(root, config.data.sources);
  if (controller) {
   if (Object.keys(replacements).length) await controller.replaceFiles(replacements);
  } else if (Object.keys(replacements).length === config.data.sources.length) {
   await start(
    config.data.sources.map((source) => ({ source, file: replacements[source.id] })),
   );
  } else {
   render({ status: "error", error: "Select one file for every declared source." });
  }
 });
 window.addEventListener("pagehide", () => controller?.dispose(), { once: true });

 if (inputs?.length) return start(inputs);
 render({ status: "waiting", error: null });
 return null;
}

function buildFilters(container, filters) {
 container.replaceChildren();
 for (const filter of filters) {
  const field = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = filter.id;
  field.append(legend);
  if (filter.kind === "select") {
   const search = document.createElement("input");
   search.type = "search";
   search.id = `filter-${filter.id}-search`;
   search.placeholder = `Search ${filter.id} options`;
   search.setAttribute("aria-label", `Search ${filter.id} options`);
   const select = document.createElement("select");
   select.id = `filter-${filter.id}`;
   select.setAttribute("aria-label", filter.id);
   const previous = optionPageButton(filter.id, "previous", "Previous options");
   const next = optionPageButton(filter.id, "next", "More options");
   field.append(search, select, previous, next);
  } else if (filter.kind === "date-range") {
   const from = document.createElement("input");
   from.type = "date";
   from.id = `filter-${filter.id}-from`;
   from.setAttribute("aria-label", `${filter.id} from`);
   const through = document.createElement("input");
   through.type = "date";
   through.id = `filter-${filter.id}-through`;
   through.setAttribute("aria-label", `${filter.id} through`);
   field.append(from, " through ", through);
  } else {
   const all = document.createElement("input");
   all.type = "checkbox";
   all.id = `filter-${filter.id}-all`;
   const allLabel = document.createElement("label");
   allLabel.htmlFor = all.id;
   allLabel.textContent = "All";
   const input = document.createElement("input");
   input.type = "text";
   input.id = `filter-${filter.id}`;
   input.setAttribute("aria-label", filter.id);
   field.append(all, allLabel, input);
  }
  container.append(field);
 }
 const apply = document.createElement("button");
 apply.id = "apply-filters";
 apply.type = "button";
 apply.textContent = "Apply filters";
 container.append(apply);
}

function optionPageButton(id, action, label) {
 const button = document.createElement("button");
 button.type = "button";
 button.dataset.optionPage = action === "next" ? "next" : "previous";
 button.dataset.filterId = id;
 button.textContent = label;
 return button;
}

function buildSources(container, sources) {
 container.replaceChildren();
 for (const source of sources) {
  const label = document.createElement("label");
  label.textContent = `${source.id} `;
  const input = document.createElement("input");
  input.type = "file";
  input.id = `source-${source.id}`;
  label.append(input);
  container.append(label);
 }
 const replace = document.createElement("button");
 replace.id = "replace-files";
 replace.type = "button";
 replace.textContent = "Load selected files";
 container.append(replace);
}

function buildLayout(container, components) {
 container.replaceChildren();
 for (const component of components) {
  const section = document.createElement("section");
  section.id = `component-${component.id}`;
  section.dataset.componentType = component.type;
  const heading = document.createElement("h2");
  heading.textContent = component.label;
  section.append(heading);
  if (component.type === "kpi") {
   const value = document.createElement("output");
   value.dataset.value = "";
   value.textContent = "—";
   section.append(value);
  } else if (component.type === "table") {
   const table = document.createElement("table");
   const head = document.createElement("thead");
   const headingRow = document.createElement("tr");
   for (const column of component.columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column.label;
    headingRow.append(cell);
   }
   head.append(headingRow);
   table.append(head, document.createElement("tbody"));
   const empty = document.createElement("p");
   empty.dataset.empty = "";
   const navigation = document.createElement("nav");
   navigation.setAttribute("aria-label", `${component.label} pages`);
   navigation.append(
    tablePageButton(component.id, "previous", "Previous page"),
    Object.assign(document.createElement("span"), { textContent: "Page 1" }),
    tablePageButton(component.id, "next", "Next page"),
   );
   navigation.children[1].dataset.pageLabel = "";
   section.append(table, empty, navigation);
  } else {
   const chart = document.createElement("div");
   chart.className = "chart";
   chart.setAttribute("role", "img");
   chart.setAttribute("aria-label", component.label);
   const summary = document.createElement("p");
   summary.dataset.chartSummary = "";
   const empty = document.createElement("p");
   empty.dataset.empty = "";
   section.append(chart, summary, empty);
  }
  container.append(section);
 }
}

function tablePageButton(id, action, label) {
 const button = document.createElement("button");
 button.type = "button";
 button.dataset.pageAction = action;
 button.dataset.componentId = id;
 button.textContent = label;
 return button;
}

function renderState(root, config, state) {
 const status = root.querySelector("#dashboard-status");
 status.dataset.state = state.status;
 status.textContent =
  state.status === "loading"
   ? "Loading dashboard…"
   : state.status === "waiting"
    ? "Select the declared data files to load this dashboard."
    : state.status === "busy"
     ? "Updating dashboard…"
     : state.status === "error"
      ? `${state.retained ? "Showing prior results. " : ""}${state.error}`
      : "Dashboard ready";
 if (state.timings) {
  status.dataset.loadMs = String(Math.round(state.timings.loadMs));
  status.dataset.queryMs = String(Math.round(state.timings.queryMs));
 }
 root.querySelectorAll("button, input, select").forEach((control) => {
  const sourceControl = control.id === "replace-files" || control.closest("#dashboard-sources");
  control.disabled =
   state.status === "loading" || state.status === "busy" ||
   (state.status === "waiting" && !sourceControl);
 });
 if (!state.filterValues) return;

 for (const filter of config.filters) renderFilter(root, filter, state);
 root.querySelector("#active-filter-state").textContent = config.filters
  .map((filter) => activeFilterText(filter, state.filterValues))
  .join("; ");
 const latest = config.filters.find(
  ({ kind, default: value }) => kind === "date-range" && value.kind === "latest-days",
 );
 root.querySelector("#snapshot-note").textContent = latest && state.filterValues[`${latest.id}_to`]
  ? `Snapshot end ${addDays(state.filterValues[`${latest.id}_to`], -1)} may be incomplete.`
  : "Snapshot end unavailable.";

 for (const component of config.layout) {
  const rows = state.results[component.query] ?? [];
  if (component.type === "kpi") {
   const value = rows[0]?.[component.field];
   root.querySelector(`#component-${component.id} [data-value]`).textContent =
    formatValue(value, component.decimals);
  } else if (component.type === "table") {
   renderTable(root, component, rows, state.tablePages[component.id], state.status);
  } else {
   renderChart(root, component, rows);
  }
 }
}

function renderFilter(root, filter, state) {
 if (filter.kind === "select") {
  const select = root.querySelector(`#filter-${filter.id}`);
  const selected = state.filterValues[filter.id];
  const values = [...(state.filterOptions[filter.id] ?? [])];
  if (selected != null && !values.some((value) => optionKey(value) === optionKey(selected))) {
   values.unshift(selected);
  }
  select.replaceChildren(option(null, "all"));
  for (const value of values) select.append(option(value, optionLabel(value)));
  select.value = optionKey(selected);
  const page = state.filterOptionPages[filter.id];
  const locked = state.status === "loading" || state.status === "busy";
  root.querySelector(`[data-option-page="previous"][data-filter-id="${filter.id}"]`).disabled = locked || page.page === 0;
  root.querySelector(`[data-option-page="next"][data-filter-id="${filter.id}"]`).disabled = locked || !page.hasNext;
 } else if (filter.kind === "date-range") {
  root.querySelector(`#filter-${filter.id}-from`).value = state.filterValues[`${filter.id}_from`] ?? "";
  const to = state.filterValues[`${filter.id}_to`];
  root.querySelector(`#filter-${filter.id}-through`).value = to ? addDays(to, -1) : "";
 } else {
  const value = state.filterValues[filter.id];
  root.querySelector(`#filter-${filter.id}`).value = value ?? "";
  root.querySelector(`#filter-${filter.id}-all`).checked = value == null;
 }
}

function activeFilterText(filter, values) {
 if (filter.kind === "date-range") {
  const from = values[`${filter.id}_from`];
  const to = values[`${filter.id}_to`];
  return `${filter.id}: ${from && to ? `${from} through ${addDays(to, -1)}` : "all"}`;
 }
 const value = values[filter.id];
 return `${filter.id}: ${value == null ? "all" : value === "" ? "(empty)" : String(value)}`;
}

function renderTable(
 root,
 component,
 rows,
 page = { page: 0, hasNext: false },
 status = "ready",
) {
 const section = root.querySelector(`#component-${component.id}`);
 const body = section.querySelector("tbody");
 body.replaceChildren();
 for (const row of rows) {
  const tableRow = document.createElement("tr");
  for (const column of component.columns) {
   const cell = document.createElement("td");
   cell.textContent = formatScalar(row[column.field]);
   tableRow.append(cell);
  }
  body.append(tableRow);
 }
 section.querySelector("[data-empty]").textContent = rows.length ? "" : "No rows";
 section.querySelector("[data-page-label]").textContent = `Page ${page.page + 1}`;
 const locked = status === "loading" || status === "busy";
 section.querySelector('[data-page-action="previous"]').disabled = locked || page.page === 0;
 section.querySelector('[data-page-action="next"]').disabled = locked || !page.hasNext;
}

function renderChart(root, component, rows) {
 const section = root.querySelector(`#component-${component.id}`);
 const chartNode = section.querySelector(".chart");
 const empty = section.querySelector("[data-empty]");
 const summary = section.querySelector("[data-chart-summary]");
 empty.textContent = rows.length ? "" : "No rows";
 summary.textContent = rows.slice(0, 200).map((row) => chartRowLabel(component, row)).join("; ");
 let chart = charts.get(chartNode);
 if (!chart) {
  chart = echarts.init(chartNode);
  charts.set(chartNode, chart);
 }
 chart.setOption(chartOptions(component, rows), true);
}

function chartOptions(component, rows) {
 if (component.type === "heatmap") {
  const xs = unique(rows.map((row) => category(row[component.x])));
  const ys = unique(rows.map((row) => category(row[component.y])));
  const xIndexes = new Map(xs.map((value, index) => [value, index]));
  const yIndexes = new Map(ys.map((value, index) => [value, index]));
  const data = rows.map((row) => [
   xIndexes.get(category(row[component.x])),
   yIndexes.get(category(row[component.y])),
   chartNumber(row[component.value]),
  ]);
  const maximum = Math.max(0, ...data.map((entry) => entry[2] ?? 0));
  return {
   animation: false,
   aria: { enabled: true },
   tooltip: {},
   grid: { containLabel: true },
   xAxis: { type: "category", data: xs },
   yAxis: { type: "category", data: ys },
   visualMap: { min: 0, max: maximum, calculable: true, orient: "horizontal" },
   series: [{ name: component.label, type: "heatmap", data }],
  };
 }
 const xs = unique(rows.map((row) => category(row[component.x])));
 const seriesNames = component.series
  ? unique(rows.map((row) => category(row[component.series])))
  : [component.label];
 const points = new Map(
  rows.map((row) => [
   JSON.stringify([
    category(row[component.x]),
    component.series ? category(row[component.series]) : component.label,
   ]),
   row,
  ]),
 );
 const series = seriesNames.map((name) => {
  const item = {
   name,
   type: component.type,
   data: xs.map((x) => {
    const row = points.get(JSON.stringify([x, name]));
    return row ? chartNumber(row[component.y]) : null;
   }),
  };
  if (component.type === "line") item.connectNulls = false;
  return item;
 });
 const annotationData = (component.annotations ?? [])
  .filter(({ at }) => xs.length && at >= xs[0] && at <= xs[xs.length - 1])
  .map(({ at, label }) => ({ xAxis: at, label: { formatter: label } }));
 if (annotationData.length && series.length) {
  series[0].markLine = { symbol: "none", data: annotationData };
 }
 const horizontal = component.type === "bar" && component.orientation === "horizontal";
 return {
  animation: false,
  aria: { enabled: true },
  tooltip: { trigger: "axis" },
  legend: component.series ? {} : undefined,
  grid: { containLabel: true },
  xAxis: horizontal ? { type: "value", name: component.label } : { type: "category", data: xs },
  yAxis: horizontal ? { type: "category", data: xs } : { type: "value", name: component.label },
  series,
 };
}

function chartRowLabel(component, row) {
 const metric = component.type === "heatmap" ? component.value : component.y;
 const categories = component.type === "heatmap"
  ? [component.x, component.y]
  : [component.x, ...(component.series ? [component.series] : [])];
 return `${categories.map((field) => category(row[field])).join(" / ")}: ${formatValue(row[metric])}`;
}

function readFilters(root, filters) {
 const values = {};
 for (const filter of filters) {
  if (filter.kind === "select") {
   values[filter.id] = root.querySelector(`#filter-${filter.id}`).selectedOptions[0].featherbiValue;
  } else if (filter.kind === "date-range") {
   const from = root.querySelector(`#filter-${filter.id}-from`).value;
   const through = root.querySelector(`#filter-${filter.id}-through`).value;
   values[`${filter.id}_from`] = from || null;
   values[`${filter.id}_to`] = through ? addDays(through, 1) : null;
  } else {
   values[filter.id] = root.querySelector(`#filter-${filter.id}-all`).checked
    ? null
    : root.querySelector(`#filter-${filter.id}`).value;
  }
 }
 return values;
}

function selectedFiles(root, sources) {
 return Object.fromEntries(
  sources
   .map((source) => [source.id, root.querySelector(`#source-${source.id}`).files[0]])
   .filter(([, file]) => file),
 );
}

function option(value, label) {
 const node = document.createElement("option");
 node.value = optionKey(value);
 node.featherbiValue = value;
 node.textContent = label;
 return node;
}

function optionKey(value) {
 if (value == null) return "null";
 return typeof value === "bigint" ? `bigint:${value}` : JSON.stringify(value);
}

function optionLabel(value) {
 return value === "" ? "(empty)" : String(value);
}

function formatValue(value, decimals) {
 if (value == null) return "—";
 if (typeof value === "bigint") return value.toLocaleString("en-US");
 if (typeof value === "number") {
  return decimals === undefined
   ? value.toLocaleString("en-US")
   : value.toFixed(decimals);
 }
 return String(value);
}

function formatScalar(value) {
 if (value == null) return "(missing)";
 if (value === "") return "(empty)";
 if (value instanceof Date) return value.toISOString().replace("T", " ").replace("Z", "");
 return String(value);
}

function category(value) {
 return value == null ? "(missing)" : value === "" ? "(empty)" : formatScalar(value);
}

function chartNumber(value) {
 return value == null ? null : Number(value);
}

function unique(values) {
 return [...new Set(values)];
}

function debounce(key, action) {
 clearTimeout(debounceTimers.get(key));
 debounceTimers.set(key, setTimeout(action, 250));
}

function addDays(value, days) {
 const date = new Date(`${value}T00:00:00Z`);
 date.setUTCDate(date.getUTCDate() + days);
 return date.toISOString().slice(0, 10);
}

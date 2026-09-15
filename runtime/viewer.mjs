import { createDashboard } from "./controller.mjs";

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
 try {
  controller = await createDashboard({ config, inputs, onState: render });
 } catch (error) {
  renderState(root, config, {
   status: "error",
   error: error instanceof Error ? error.message : String(error),
  });
  throw error;
 }

 root.querySelector("#apply-filters").addEventListener("click", async () => {
  await controller.applyFilters(readFilters(root, config.filters));
 });
 root.querySelector("#replace-files").addEventListener("click", async () => {
  const replacements = {};
  for (const source of config.data.sources) {
   const file = root.querySelector(`#source-${source.id}`).files[0];
   if (file) replacements[source.id] = file;
  }
  if (Object.keys(replacements).length) {
   await controller.replaceFiles(replacements);
  }
 });
 window.addEventListener("pagehide", () => controller.dispose(), { once: true });
 return controller;
}

function buildFilters(container, filters) {
 container.replaceChildren();
 for (const filter of filters) {
  const field = document.createElement("label");
  field.textContent = `${filter.id} `;
  if (filter.kind === "select") {
   const select = document.createElement("select");
   select.id = `filter-${filter.id}`;
   field.append(select);
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
   const input = document.createElement("input");
   input.type = "text";
   input.id = `filter-${filter.id}`;
   field.append(input);
  }
  container.append(field);
 }
 const apply = document.createElement("button");
 apply.id = "apply-filters";
 apply.type = "button";
 apply.textContent = "Apply filters";
 container.append(apply);
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
 replace.textContent = "Replace selected files";
 container.append(replace);
}

function buildLayout(container, components) {
 container.replaceChildren();
 for (const component of components) {
  const section = document.createElement("section");
  section.id = `component-${component.id}`;
  const heading = document.createElement("h2");
  heading.textContent = component.label;
  section.append(heading);
  if (component.type === "kpi") {
   const value = document.createElement("output");
   value.dataset.value = "";
   value.textContent = "—";
   section.append(value);
  } else {
   const note = document.createElement("p");
   note.textContent = "Not rendered in this first dashboard slice.";
   section.append(note);
  }
  container.append(section);
 }
}

function renderState(root, config, state) {
 const status = root.querySelector("#dashboard-status");
 status.dataset.state = state.status;
 status.textContent =
  state.status === "loading"
   ? "Loading dashboard…"
   : state.status === "busy"
     ? "Updating dashboard…"
     : state.status === "error"
       ? `${state.retained ? "Showing prior results. " : ""}${state.error}`
       : "Dashboard ready";
 root.querySelectorAll("button, input, select").forEach((control) => {
  control.disabled = state.status === "loading" || state.status === "busy";
 });
 if (!state.filterValues) return;

 for (const filter of config.filters) {
  if (filter.kind === "select") {
   const select = root.querySelector(`#filter-${filter.id}`);
   const selected = state.filterValues[filter.id];
   select.replaceChildren(option(null, "all"));
   for (const value of state.filterOptions[filter.id] ?? []) {
    select.append(option(value, String(value)));
   }
   select.value = JSON.stringify(selected);
  } else if (filter.kind === "date-range") {
   root.querySelector(`#filter-${filter.id}-from`).value =
    state.filterValues[`${filter.id}_from`] ?? "";
   const to = state.filterValues[`${filter.id}_to`];
   root.querySelector(`#filter-${filter.id}-through`).value = to
    ? addDays(to, -1)
    : "";
  } else {
   root.querySelector(`#filter-${filter.id}`).value =
    state.filterValues[filter.id] ?? "";
  }
 }
 root.querySelector("#active-filter-state").textContent = config.filters
  .map((filter) => {
   if (filter.kind === "date-range") {
    const from = state.filterValues[`${filter.id}_from`];
    const to = state.filterValues[`${filter.id}_to`];
    return `${filter.id}: ${from && to ? `${from} through ${addDays(to, -1)}` : "all"}`;
   }
   return `${filter.id}: ${state.filterValues[filter.id] ?? "all"}`;
  })
  .join("; ");

 for (const component of config.layout) {
  if (component.type !== "kpi") continue;
  const value = state.results[component.query]?.[0]?.[component.field];
  root.querySelector(`#component-${component.id} [data-value]`).textContent =
   formatValue(value, component.decimals);
 }
}

function readFilters(root, filters) {
 const values = {};
 for (const filter of filters) {
  if (filter.kind === "select") {
   values[filter.id] = root.querySelector(
    `#filter-${filter.id}`,
   ).selectedOptions[0].featherbiValue;
  } else if (filter.kind === "date-range") {
   const from = root.querySelector(`#filter-${filter.id}-from`).value;
   const through = root.querySelector(`#filter-${filter.id}-through`).value;
   values[`${filter.id}_from`] = from || null;
   values[`${filter.id}_to`] = through ? addDays(through, 1) : null;
  } else {
   values[filter.id] = root.querySelector(`#filter-${filter.id}`).value || null;
  }
 }
 return values;
}

function option(value, label) {
 const node = document.createElement("option");
 node.value = JSON.stringify(value);
 node.featherbiValue = value;
 node.textContent = label;
 return node;
}

function formatValue(value, decimals) {
 if (value == null) return "—";
 if (typeof value === "bigint") return value.toString();
 if (typeof value === "number" && decimals !== undefined) {
  return value.toFixed(decimals);
 }
 return String(value);
}

function addDays(value, days) {
 const date = new Date(`${value}T00:00:00Z`);
 date.setUTCDate(date.getUTCDate() + days);
 return date.toISOString().slice(0, 10);
}

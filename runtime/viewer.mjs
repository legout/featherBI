import { createDashboard } from "./controller.mjs";
import { componentInteractionField, selectableFields } from "../contract/config.mjs";

const charts = new WeakMap();
const debounceTimers = new Map();

/** Mount the fixed grid viewer for one validated dashboard config. */
export async function mountDashboard({
 config,
 inputs,
 root = document,
 capabilities = {},
}) {
 root.title = config.title;
 root.querySelector("#dashboard-title").textContent = config.title;
 const filters = root.querySelector("#dashboard-filters");
 const sources = root.querySelector("#dashboard-sources");
 const layout = root.querySelector("#dashboard-layout");
 root.querySelector("#dashboard").dataset.theme = config.theme ?? "neutral";
 buildFilters(filters, config.filters);
 buildSources(sources, config.data.sources);
 buildLayout(layout, config);
 applyThemeClasses(root, config.theme ?? "neutral");
 const playground = config.playground
  ? buildPlayground(root, config, capabilities.editor)
  : null;

 let controller;
 // Pending filter edits: control values changed by the recipient but not
 // yet accepted as the active revision (CONTEXT.md "pending filter edits").
 const drafts = new Map();
 // Focus restoration across renders that lock and unlock controls.
 const focus = { restoreId: null };
 let syncedRevision;
 const render = (state) => {
  // Sync controls from the snapshot only for an accepted revision or a
  // retained-error rollback; every other render preserves pending edits. An
  // option-read failure retains the snapshot without touching the controls,
  // so its pending edits (and typed search/focus) survive (spec §1, §2).
  const syncControls =
   Boolean(state.filterValues) &&
   (state.revision !== syncedRevision ||
    (state.status === "error" &&
     state.retained &&
     !state.pendingEditsPreserved));
  renderState(root, config, state, capabilities, { drafts, syncControls, focus });
  if (syncControls) {
   syncedRevision = state.revision;
   drafts.clear();
  }
 };
 const start = async (assignments) => {
  try {
   controller = await createDashboard({
    config,
    inputs: assignments,
    onState: render,
    liveCredentials: (source, priorError) =>
     promptLiveCredentials(root, source, priorError),
   });
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

 const recordDraft = (control) => {
  for (const filter of config.filters) {
   if (
    ["select", "single-select", "multi-select", "option-search"].includes(
     filter.kind,
    )
   ) {
    if (control.id !== `filter-${filter.id}`) continue;
    const selected = [...control.selectedOptions].map(
     (entry) => entry.featherbiValue,
    );
    drafts.set(
     filter.id,
     filter.kind === "multi-select" ? selected : (selected[0] ?? null),
    );
    return;
   }
   if (filter.kind === "date-range" || filter.kind === "numeric-range") {
    if (control.id === `filter-${filter.id}-from`) {
     drafts.set(`${filter.id}_from`, control.value === "" ? null : control.value);
     return;
    }
    if (control.id === `filter-${filter.id}-through`) {
     drafts.set(
      `${filter.id}_to`,
      control.value === ""
       ? null
       : filter.kind === "numeric-range"
         ? Number(control.value)
         : addDays(control.value, 1),
     );
     return;
    }
    continue;
   }
   if (filter.kind === "boolean") {
    if (control.name !== `filter-${filter.id}`) continue;
    drafts.set(filter.id, booleanChoice(control.value));
    return;
   }
   if (control.id === `filter-${filter.id}`) {
    drafts.set(
     filter.id,
     root.querySelector(`#filter-${filter.id}-all`).checked
      ? null
      : control.value,
    );
    return;
   }
   if (control.id === `filter-${filter.id}-all`) {
    drafts.set(
     filter.id,
     control.checked
      ? null
      : root.querySelector(`#filter-${filter.id}`).value,
    );
    return;
   }
  }
 };

 filters.addEventListener("focusin", () => {
  focus.restoreId = null;
 });
 filters.addEventListener("input", (event) => {
  if (!controller) return;
  const control = event.target;
  recordDraft(control);
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
   ({ id, kind }) =>
    ["select", "single-select", "multi-select", "option-search"].includes(
     kind,
    ) && control.id === `filter-${id}-search`,
  );
  if (optionFilter) {
   debounce(`options:${optionFilter.id}`, () =>
    controller.searchFilterOptions(optionFilter.id, control.value, 0),
   );
  }
 });

 filters.addEventListener("change", (event) => {
  if (!controller) return;
  recordDraft(event.target);
 });

 layout.addEventListener("featherbi-chart-select", async (event) => {
  if (!controller) return;
  const section = event.target.closest("section");
  await applyMarkSelection(
   root,
   config,
   controller,
   section,
   event.detail.pairs,
   event.detail.modifier,
  );
 });

 filters.addEventListener("click", async (event) => {
  if (!controller) return;
  const action = event.target.dataset.optionPage;
  const id = event.target.dataset.filterId;
  if (!action || !id) return;
  const current = controller.state.filterOptionPages[id];
  const page =
   action === "next" ? current.page + 1 : Math.max(0, current.page - 1);
  try {
   await controller.searchFilterOptions(id, current.search, page);
  } catch {
   // The controller has already emitted the retained visible error state.
  }
 });

 layout.addEventListener("featherbi-grid-select", async (event) => {
  if (!controller) return;
  const section = event.target.closest("section");
  await selectDimension(
   root,
   config,
   controller,
   section,
   event.detail.value,
   event.detail.modifier,
   event.detail.dimension,
   event.detail.action,
  );
 });

 layout.addEventListener("click", async (event) => {
  if (event.target.dataset.tabTarget) {
   openTab(root, event.target.dataset.tabTarget);
   return;
  }
  if (!controller) return;
  const actionValue = Object.hasOwn(event.target, "featherbiValue")
   ? event.target.featherbiValue
   : event.target.dataset.actionValue;
  if (actionValue !== undefined) {
   const typedAction =
    event.target.dataset.actionOpenTab || event.target.dataset.actionDrilldown
     ? {
        openTab: event.target.dataset.actionOpenTab,
        drilldown: event.target.dataset.actionDrilldown,
       }
     : undefined;
   await selectDimension(
    root,
    config,
    controller,
    event.target.closest("section"),
    actionValue,
    event.shiftKey || event.metaKey || event.ctrlKey,
    event.target.dataset.actionDimension,
    typedAction,
   );
   return;
  }
  if (event.target.dataset.brushApply !== undefined) {
   await applyBrush(config, controller, event.target.closest("section"));
   return;
  }
  const action = event.target.dataset.pageAction;
  const id = event.target.dataset.componentId;
  if (!action || !id) return;
  const current = controller.state.tablePages[id]?.page ?? 0;
  await controller.setTablePage(
   id,
   action === "next" ? current + 1 : Math.max(0, current - 1),
  );
 });

 root.querySelector("#apply-filters").addEventListener("click", async () => {
  if (controller)
   await controller.applyFilters(readFilters(root, config.filters));
 });
 root.querySelector("#replace-files").addEventListener("click", async () => {
  const localCount = config.data.sources.filter(({ remote }) => !remote).length;
  const replacements = selectedFiles(root, config.data.sources);
  if (controller) {
   if (Object.keys(replacements).length)
    await controller.replaceFiles(replacements);
  } else if (Object.keys(replacements).length === localCount) {
   await start(
    config.data.sources
     .filter(({ remote }) => !remote)
     .map((source) => ({ source, file: replacements[source.id] })),
   );
  } else {
   render({
    status: "error",
    error: "Select one file for every declared local source.",
   });
  }
 });
 if (playground) {
  playground.run.addEventListener("click", async () => {
   if (!controller) return;
   playground.error.textContent = "";
   playground.run.disabled = true;
   try {
    const result = await controller.runPlayground(playground.editor.getValue());
    renderPlaygroundResult(
     playground,
     result,
     config.playground.renderer,
     capabilities,
    );
   } catch (error) {
    playground.error.textContent =
     error instanceof Error ? error.message : String(error);
   } finally {
    playground.run.disabled = false;
   }
  });
 }
 window.addEventListener("resize", () =>
  requestAnimationFrame(() =>
   layout
    .querySelectorAll(".chart")
    .forEach((node) => charts.get(node)?.resize()),
  ),
 );
 window.addEventListener(
  "pagehide",
  () => {
   playground?.editor.dispose();
   capabilities.perspective?.disposeAll();
   controller?.dispose();
  },
  { once: true },
 );

 if (inputs?.length) return start(inputs);
 if (config.data.sources.every(({ remote }) => remote)) {
  // Live-only dashboards need no local files; start reads immediately.
  return start([]);
 }
 render({ status: "waiting", error: null });
 return {
  runPlayground(...args) {
   if (!controller)
    throw new Error("Select the declared data files before running SQL");
   return controller.runPlayground(...args);
  },
  dispose() {
   return controller?.dispose();
  },
 };
}

function buildFilters(container, filters) {
 container.replaceChildren();
 for (const filter of filters) {
  const field = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = filter.id;
  field.append(legend);
  if (
   ["select", "single-select", "multi-select", "option-search"].includes(
    filter.kind,
   )
  ) {
   const search = document.createElement("input");
   search.type = "search";
   search.id = `filter-${filter.id}-search`;
   search.placeholder = `Search ${filter.id} options`;
   search.setAttribute("aria-label", `Search ${filter.id} options`);
   const select = document.createElement("select");
   select.id = `filter-${filter.id}`;
   select.multiple = filter.kind === "multi-select";
   select.setAttribute("aria-label", filter.id);
   const previous = optionPageButton(filter.id, "previous", "Previous options");
   const next = optionPageButton(filter.id, "next", "More options");
   field.append(search, select, previous, next);
  } else if (filter.kind === "date-range" || filter.kind === "numeric-range") {
   const from = document.createElement("input");
   from.type = filter.kind === "date-range" ? "date" : "number";
   from.id = `filter-${filter.id}-from`;
   from.setAttribute("aria-label", `${filter.id} from`);
   const through = document.createElement("input");
   through.type = filter.kind === "date-range" ? "date" : "number";
   through.id = `filter-${filter.id}-through`;
   through.setAttribute("aria-label", `${filter.id} through`);
   field.append(from, " through ", through);
  } else if (filter.kind === "boolean") {
   // Native three-choice All/Yes/No (null/true/false): a radio group keeps
   // every choice reachable by keyboard, including back to All (spec §2).
   for (const [value, label] of [
    [null, "All"],
    [true, "Yes"],
    [false, "No"],
   ]) {
    const choice = document.createElement("input");
    choice.type = "radio";
    choice.id = `filter-${filter.id}-${label.toLowerCase()}`;
    choice.name = `filter-${filter.id}`;
    choice.value = String(value);
    const choiceLabel = document.createElement("label");
    choiceLabel.htmlFor = choice.id;
    choiceLabel.textContent = label;
    field.append(choice, choiceLabel);
   }
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
  if (source.remote) {
   const note = document.createElement("p");
   note.className = "remote-source";
   note.dataset.remoteSource = source.id;
   note.textContent =
    source.remote.auth === "s3"
     ? `${source.id} (remote; asks for credentials on first use)`
     : `${source.id} (remote; reads live)`;
   container.append(note);
   continue;
  }
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

/**
 * Ask the recipient once per session for one private live source's
 * credentials. Values resolve through the controller into a temporary
 * in-memory DuckDB secret and are never persisted or logged.
 */
export function promptLiveCredentials(root, source, priorError) {
 return new Promise((resolve) => {
  const dialog = document.createElement("dialog");
  const heading = Object.assign(document.createElement("h2"), {
   textContent: `Credentials for ${source.id}`,
  });
  const note = Object.assign(document.createElement("p"), {
   textContent:
    "Used only for this session's reads; never stored or included in the dashboard.",
  });
  const errorLine = Object.assign(document.createElement("p"), {
   textContent: priorError ? `Last attempt failed: ${priorError}` : "",
  });
  errorLine.setAttribute("role", "alert");
  errorLine.dataset.credentialError = "";
  const keyField = credentialField("Key ID", "text", "keyId", true);
  const secretField = credentialField("Secret", "password", "secret", true);
  const tokenField = credentialField(
   "Session token (optional)",
   "password",
   "sessionToken",
   false,
  );
  const submit = Object.assign(document.createElement("button"), {
   type: "submit",
   textContent: "Read source",
  });
  const cancel = Object.assign(document.createElement("button"), {
   type: "button",
   textContent: "Cancel",
  });
  let settled = false;
  const done = (value) => {
   if (settled) return;
   settled = true;
   dialog.close();
   dialog.remove();
   resolve(value);
  };
  cancel.addEventListener("click", () => done(null));
  dialog.addEventListener("close", () => {
   if (settled) return;
   settled = true;
   dialog.remove();
   resolve(null);
  });
  const form = document.createElement("form");
  form.append(
   heading,
   note,
   errorLine,
   keyField.label,
   secretField.label,
   tokenField.label,
   submit,
   cancel,
  );
  form.addEventListener("submit", (event) => {
   event.preventDefault();
   done({
    keyId: keyField.input.value,
    secret: secretField.input.value,
    sessionToken: tokenField.input.value || undefined,
   });
  });
  dialog.append(form);
  (root.body ?? root).append(dialog);
  dialog.showModal();
 });
}

function credentialField(text, type, name, required) {
 const label = document.createElement("label");
 label.textContent = ` ${text}`;
 const input = document.createElement("input");
 input.type = type;
 input.name = name;
 input.required = required;
 input.setAttribute("aria-label", text);
 label.prepend(input);
 return { label, input };
}

function buildPlayground(root, config, editorCapability) {
 const section = root.querySelector("#dashboard-playground");
 section.hidden = false;
 section.replaceChildren();
 const heading = Object.assign(document.createElement("h2"), {
  textContent: "SQL playground",
 });
 const context = Object.assign(document.createElement("p"), {
  textContent:
   "Dashboard filters are shown above for context and are not injected into this query.",
 });
 const editorNode = document.createElement("div");
 editorNode.dataset.playgroundEditor = "";
 editorNode.dataset.completions = Object.keys(config.playground.schemas).join(
  ",",
 );
 const run = Object.assign(document.createElement("button"), {
  type: "button",
  textContent: "Run query",
 });
 run.dataset.playgroundRun = "";
 const error = document.createElement("p");
 error.dataset.playgroundError = "";
 error.setAttribute("role", "alert");
 const result = document.createElement("div");
 result.dataset.playgroundResult = "";
 section.append(heading, context, editorNode, run, error, result);
 return {
  section,
  run,
  error,
  result,
  editor: editorCapability.mount(editorNode, config.playground.schemas),
 };
}

function renderPlaygroundResult(
 playground,
 queryResult,
 renderer,
 capabilities,
) {
 playground.error.textContent = "";
 const columns = queryResult.table.schema.fields.map(({ name }) => ({
  field: name,
  label: name,
 }));
 if (renderer === "perspective") {
  capabilities.perspective
   .render(playground.result, queryResult.ipc, {
    plugin: "Datagrid",
    columns: columns.map(({ field }) => field),
   })
   .catch((error) => {
    playground.error.textContent =
     error instanceof Error ? error.message : String(error);
   });
 } else {
  capabilities.grid.render(playground.result, queryResult.rows, columns);
 }
}

function buildLayout(container, config) {
 const components = config.layout;
 container.replaceChildren();
 for (const component of components) {
  const section = document.createElement("section");
  section.id = `component-${component.id}`;
  section.dataset.componentType = component.type;
  section.style.setProperty("--grid-x", component.x);
  section.style.setProperty("--grid-y", component.y);
  section.style.setProperty("--grid-width", component.width);
  section.style.setProperty("--grid-height", component.height);
  const heading = document.createElement("h2");
  heading.textContent = component.label;
  section.append(heading);
  if (["heading", "markdown", "text"].includes(component.type)) {
   const content = document.createElement(
    component.type === "heading" ? "h3" : "p",
   );
   content.textContent = component.content;
   section.append(content);
  } else if (component.type === "divider") {
   section.append(document.createElement("hr"));
  } else if (component.type === "tabs") {
   const group = document.createElement("div");
   group.setAttribute("role", "tablist");
   for (const tab of component.tabs ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.dataset.tabTarget = tab.id;
    button.dataset.tabComponents = (tab.components ?? []).join(",");
    button.textContent = tab.label;
    group.append(button);
   }
   section.append(group);
  } else if (component.type === "section") {
   const group = document.createElement("div");
   group.textContent = component.label;
   section.append(group);
  } else if (component.type === "kpi") {
   const value = document.createElement("output");
   value.dataset.value = "";
   value.textContent = "—";
   section.append(value);
  } else if (component.type === "metric-group") {
   for (const field of component.fields) {
    const value = document.createElement("output");
    value.dataset.metric = field;
    value.textContent = "—";
    section.append(value);
   }
  } else if (component.type === "table") {
   const grid = document.createElement("div");
   grid.className = "data-grid";
   grid.dataset.grid = "";
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
   section.append(grid, empty, navigation);
  } else {
   const chart = document.createElement("div");
   const usePerspective =
    component.type === "perspective" ||
    (config.rendererPreset === "perspective-first" &&
     isChartType(component.type));
   chart.className = usePerspective ? "perspective-host" : "chart";
   if (usePerspective) chart.dataset.perspective = "";
   chart.setAttribute("role", "img");
   chart.setAttribute("aria-label", component.label);
   const summary = document.createElement("p");
   summary.dataset.chartSummary = "";
   const empty = document.createElement("p");
   empty.dataset.empty = "";
   section.append(chart, summary, empty);
   if (component.brushDimension) {
    const from = document.createElement("input");
    from.type = "date";
    from.dataset.brushFrom = "";
    from.setAttribute("aria-label", `${component.label} brush from`);
    const through = document.createElement("input");
    through.type = "date";
    through.dataset.brushThrough = "";
    through.setAttribute("aria-label", `${component.label} brush through`);
    const apply = document.createElement("button");
    apply.type = "button";
    apply.dataset.brushApply = "";
    apply.textContent = "Apply range";
    section.append(from, through, apply);
   }
  }
  container.append(section);
 }
 for (const tablist of container.querySelectorAll('[role="tablist"]')) {
  const first = tablist.querySelector('[role="tab"]');
  if (first) openTab(container.ownerDocument, first.dataset.tabTarget);
 }
}

function applyThemeClasses(root, theme) {
 if (theme !== "daisyui") return;
 root.querySelectorAll("button").forEach((node) => node.classList.add("btn"));
 root
  .querySelectorAll("#dashboard-layout > section")
  .forEach((node) => node.classList.add("card"));
 root.querySelectorAll("table").forEach((node) => node.classList.add("table"));
 root.querySelectorAll("input").forEach((node) => node.classList.add("input"));
 root
  .querySelectorAll("select")
  .forEach((node) => node.classList.add("select"));
}

function tablePageButton(id, action, label) {
 const button = document.createElement("button");
 button.type = "button";
 button.dataset.pageAction = action;
 button.dataset.componentId = id;
 button.textContent = label;
 return button;
}

function renderState(root, config, state, capabilities, ui = {}) {
 const { drafts = new Map(), syncControls = true, focus = { restoreId: null } } = ui;
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
 const previouslyFocused = root.activeElement;
 const focusedId = previouslyFocused?.id;
 root.querySelectorAll("button, input, select").forEach((control) => {
  const sourceControl =
   control.id === "replace-files" || control.closest("#dashboard-sources");
  control.disabled =
   state.status === "loading" ||
   state.status === "busy" ||
   (state.status === "waiting" && !sourceControl);
 });
 // Locking a focused control blurs it; restore the recipient's keyboard
 // focus once the control is enabled again.
 if (focusedId && root.activeElement !== previouslyFocused)
  focus.restoreId = focusedId;
 if (
  focus.restoreId &&
  root.activeElement?.id !== focus.restoreId &&
  root.activeElement === root.body
 ) {
  const restore = root.querySelector(`[id="${focus.restoreId}"]`);
  if (restore && !restore.disabled) {
   restore.focus();
   focus.restoreId = null;
  }
 }
 if (!state.filterValues) return;

 for (const filter of config.filters)
  renderFilter(root, filter, state, drafts, syncControls);
 root.querySelector("#active-filter-state").textContent = config.filters
  .map((filter) => activeFilterText(filter, state.filterValues))
  .join("; ");
 const latest = config.filters.find(
  ({ kind, default: value }) =>
   kind === "date-range" && value.kind === "latest-days",
 );
 root.querySelector("#snapshot-note").textContent =
  latest && state.filterValues[`${latest.id}_to`]
   ? `Snapshot end ${addDays(state.filterValues[`${latest.id}_to`], -1)} may be incomplete.`
   : "Snapshot end unavailable.";

 for (const component of config.layout) {
  const rows = state.results[component.query] ?? [];
  if (component.type === "kpi") {
   const value = rows[0]?.[component.field];
   root.querySelector(`#component-${component.id} [data-value]`).textContent =
    formatValue(value, component.decimals);
  } else if (component.type === "metric-group") {
   for (const field of component.fields) {
    const value = rows[0]?.[field];
    root.querySelector(
     `#component-${component.id} [data-metric="${field}"]`,
    ).textContent = formatValue(value, component.decimals);
   }
  } else if (component.type === "table") {
   renderTable(
    root,
    component,
    rows,
    state.tablePages[component.id],
    state.status,
    capabilities.grid,
   );
  } else if (
   component.type === "perspective" ||
   (config.rendererPreset === "perspective-first" &&
    isChartType(component.type))
  ) {
   const section = root.querySelector(`#component-${component.id}`);
   const perspectiveConfig =
    component.perspective ?? perspectiveConfigForChart(component);
   capabilities.perspective
    .render(
     section.querySelector("[data-perspective]"),
     state.perspectiveResults[component.query],
     perspectiveConfig,
    )
    .then(() => {
     section.querySelector("[data-empty]").textContent = rows.length
      ? ""
      : "No rows";
    })
    .catch((error) => {
     section.querySelector("[data-empty]").textContent =
      error instanceof Error ? error.message : String(error);
    });
  } else if (component.query) {
   renderChart(root, component, rows, capabilities.charts);
  }
 }
}

function renderFilter(root, filter, state, drafts = new Map(), syncControls = true) {
 // Map membership, not nullish fallback: a recorded null draft (a cleared
 // control) is a real pending edit and must not resurrect the committed value.
 const draftValue = (key) =>
  syncControls || !drafts.has(key)
   ? state.filterValues[key]
   : drafts.get(key);
 if (
  ["select", "single-select", "multi-select", "option-search"].includes(
   filter.kind,
  )
 ) {
  const select = root.querySelector(`#filter-${filter.id}`);
  const selected = draftValue(filter.id);
  const values = [...(state.filterOptions[filter.id] ?? [])];
  const selectedValues =
   filter.kind === "multi-select" ? (selected ?? []) : [selected];
  for (const selectedValue of selectedValues) {
   if (
    selectedValue != null &&
    !values.some((value) => optionKey(value) === optionKey(selectedValue))
   )
    values.unshift(selectedValue);
  }
  // Rebuilding the options must not drop keyboard focus on the select.
  const refocus = root.activeElement === select;
  select.replaceChildren();
  if (filter.kind !== "multi-select") select.append(option(null, "all"));
  for (const value of values) select.append(option(value, optionLabel(value)));
  for (const item of select.options)
   item.selected = selectedValues.some(
    (value) => optionKey(value) === item.value,
   );
  if (refocus) select.focus();
  const page = state.filterOptionPages[filter.id];
  const locked = state.status === "loading" || state.status === "busy";
  root.querySelector(
   `[data-option-page="previous"][data-filter-id="${filter.id}"]`,
  ).disabled = locked || page.page === 0;
  root.querySelector(
   `[data-option-page="next"][data-filter-id="${filter.id}"]`,
  ).disabled = locked || !page.hasNext;
 } else if (filter.kind === "date-range" || filter.kind === "numeric-range") {
  const from = draftValue(`${filter.id}_from`);
  const to = draftValue(`${filter.id}_to`);
  root.querySelector(`#filter-${filter.id}-from`).value = from ?? "";
  root.querySelector(`#filter-${filter.id}-through`).value =
   to == null ? "" : filter.kind === "date-range" ? addDays(to, -1) : to;
 } else if (filter.kind === "boolean") {
  const value = draftValue(filter.id);
  for (const input of root.querySelectorAll(
   `input[name="filter-${filter.id}"]`,
  ))
   input.checked = booleanChoice(input.value) === value;
 } else {
  const value = draftValue(filter.id);
  root.querySelector(`#filter-${filter.id}`).value = value ?? "";
  root.querySelector(`#filter-${filter.id}-all`).checked = value == null;
 }
}

function activeFilterText(filter, values) {
 if (filter.kind === "date-range" || filter.kind === "numeric-range") {
  const from = values[`${filter.id}_from`];
  const to = values[`${filter.id}_to`];
  const through = filter.kind === "date-range" && to ? addDays(to, -1) : to;
  return `${filter.id}: ${from != null && to != null ? `${from} through ${through}` : "all"}`;
 }
 const value = values[filter.id];
 return `${filter.id}: ${value == null || (Array.isArray(value) && value.length === 0) ? "all" : value === "" ? "(empty)" : Array.isArray(value) ? value.join(", ") : String(value)}`;
}

function renderTable(
 root,
 component,
 rows,
 page = { page: 0, hasNext: false },
 status = "ready",
 gridCapability,
) {
 const section = root.querySelector(`#component-${component.id}`);
 gridCapability.render(
  section.querySelector("[data-grid]"),
  rows,
  component.columns,
 );
 section.querySelector("[data-empty]").textContent = rows.length
  ? ""
  : "No rows";
 section.querySelector("[data-page-label]").textContent =
  `Page ${page.page + 1}`;
 const locked = status === "loading" || status === "busy";
 section.querySelector('[data-page-action="previous"]').disabled =
  locked || page.page === 0;
 section.querySelector('[data-page-action="next"]').disabled =
  locked || !page.hasNext;
}

function renderChart(root, component, rows, chartCapability) {
 const section = root.querySelector(`#component-${component.id}`);
 const chartNode = section.querySelector(".chart");
 const empty = section.querySelector("[data-empty]");
 const summary = section.querySelector("[data-chart-summary]");
 empty.textContent = rows.length ? "" : "No rows";
 summary.replaceChildren();
 rows.slice(0, 200).forEach((row, index) => {
  if (index) summary.append("; ");
  const field = interactionField(component);
  if (!field) return summary.append(chartRowLabel(component, row));
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.actionValue = formatScalar(row[field]);
  button.featherbiValue = row[field];
  button.textContent = chartRowLabel(component, row);
  summary.append(button);
 });
 let chart = charts.get(chartNode);
 if (!chart) {
  chart = chartCapability.init(chartNode);
  charts.set(chartNode, chart);
  // A plotted-mark click publishes the typed values carried on the mark's
  // data item; labels and axis positions are never used to reconstruct them.
  chart.on("click", (params) => {
   if (params?.componentType !== "series") return;
   const selection = params.data?.featherbiSelection;
   if (!selection) return;
   const native = params.event?.event ?? params.event;
   chartNode.dispatchEvent(
    new CustomEvent("featherbi-chart-select", {
     bubbles: true,
     detail: {
      pairs: Object.entries(selection).map(([field, value]) => ({
       field,
       value,
      })),
      modifier: Boolean(
       native?.shiftKey || native?.metaKey || native?.ctrlKey,
      ),
     },
    }),
   );
  });
 }
 chart.setOption(chartOptions(component, rows), true);
}

function isChartType(type) {
 return [
  "bar",
  "line",
  "area",
  "scatter",
  "pie",
  "donut",
  "heatmap",
  "treemap",
  "sankey",
  "gauge",
  "boxplot",
 ].includes(type);
}

export function perspectiveConfigForChart(component) {
 if (["pie", "donut", "treemap"].includes(component.type))
  return {
   plugin: "Y Bar",
   groupBy: [component.name],
   columns: [component.value],
  };
 if (component.type === "gauge")
  return { plugin: "Datagrid", columns: [component.value] };
 if (component.type === "heatmap")
  return {
   plugin: "Datagrid",
   columns: perspectiveColumns(
    component.xField ?? component.x,
    component.yField ?? component.y,
    component.value,
   ),
  };
 if (component.type === "sankey")
  return {
   plugin: "Datagrid",
   columns: perspectiveColumns(
    component.source,
    component.target,
    component.value,
   ),
  };
 if (component.type === "boxplot")
  return {
   plugin: "Datagrid",
   columns: perspectiveColumns(
    component.xField,
    component.min,
    component.q1,
    component.median,
    component.q3,
    component.max,
   ),
  };
 return {
  plugin: component.type === "table" ? "Datagrid" : "Y Bar",
  groupBy: [component.xField ?? component.x].filter(Boolean),
  splitBy: component.series ? [component.series] : [],
  columns: [component.yField ?? component.y].filter(Boolean),
 };
}

/** Datagrid columns for chart families without an equivalent Perspective plugin; keeps every authored field once. */
function perspectiveColumns(...fields) {
 return [...new Set(fields.filter(Boolean))];
}

/** Typed per-row selection payload attached to plotted marks with mappings. */
function markPayload(component) {
 const mapping = component.selectionDimensions ?? {};
 const primary = componentInteractionField(component);
 const fields = selectableFields(component).filter(
  (field) =>
   mapping[field] !== undefined ||
   (component.interactionDimension && field === primary),
 );
 if (!fields.length) return () => undefined;
 return (row) => Object.fromEntries(fields.map((field) => [field, row[field]]));
}

function chartOptions(component, rows) {
 const payload = markPayload(component);
 const withPayload = (row, item) => {
  const selection = payload(row);
  return selection ? { ...item, featherbiSelection: selection } : item;
 };
 if (component.type === "heatmap") {
  const xField = component.xField ?? component.x;
  const yField = component.yField ?? component.y;
  const xs = unique(rows.map((row) => category(row[xField])));
  const ys = unique(rows.map((row) => category(row[yField])));
  const xIndexes = new Map(xs.map((value, index) => [value, index]));
  const yIndexes = new Map(ys.map((value, index) => [value, index]));
  const data = rows.map((row) =>
   withPayload(row, {
    value: [
     xIndexes.get(category(row[xField])),
     yIndexes.get(category(row[yField])),
     chartNumber(row[component.value]),
    ],
   }),
  );
  return {
   animation: false,
   aria: { enabled: true },
   tooltip: {},
   grid: { containLabel: true },
   xAxis: { type: "category", data: xs },
   yAxis: { type: "category", data: ys },
   visualMap: {
    min: 0,
    max: Math.max(0, ...data.map((entry) => entry.value[2] ?? 0)),
    calculable: true,
    orient: "horizontal",
   },
   series: [{ name: component.label, type: "heatmap", data }],
  };
 }
 if (["pie", "donut"].includes(component.type))
  return {
   animation: false,
   aria: { enabled: true },
   tooltip: {},
   legend: component.legend === false ? undefined : {},
   series: [
    {
     type: "pie",
     radius: component.type === "donut" ? ["45%", "70%"] : undefined,
     data: rows.map((row) =>
      withPayload(row, {
       name: category(row[component.name]),
       value: chartNumber(row[component.value]),
      }),
     ),
    },
   ],
  };
 if (component.type === "treemap")
  return {
   animation: false,
   aria: { enabled: true },
   tooltip: {},
   series: [
    {
     type: "treemap",
     data: rows.map((row) =>
      withPayload(row, {
       name: category(row[component.name]),
       value: chartNumber(row[component.value]),
      }),
     ),
    },
   ],
  };
 if (component.type === "sankey")
  return {
   animation: false,
   aria: { enabled: true },
   tooltip: {},
   series: [
    {
     type: "sankey",
     data: unique(
      rows.flatMap((row) => [
       category(row[component.source]),
       category(row[component.target]),
      ]),
     ).map((name) => ({ name })),
     links: rows.map((row) =>
      withPayload(row, {
       source: category(row[component.source]),
       target: category(row[component.target]),
       value: chartNumber(row[component.value]),
      }),
     ),
    },
   ],
  };
 if (component.type === "gauge")
  return {
   animation: false,
   aria: { enabled: true },
   series: [
    {
     type: "gauge",
     data: [
      { value: chartNumber(rows[0]?.[component.value]), name: component.label },
     ],
    },
   ],
  };
 if (component.type === "boxplot")
  return {
   animation: false,
   aria: { enabled: true },
   tooltip: {},
   xAxis: {
    type: "category",
    data: rows.map((row) => category(row[component.xField])),
   },
   yAxis: { type: "value" },
   series: [
    {
     type: "boxplot",
     data: rows.map((row) =>
      withPayload(row, {
       value: [
        component.min,
        component.q1,
        component.median,
        component.q3,
        component.max,
       ].map((field) => chartNumber(row[field])),
      }),
     ),
    },
   ],
  };
 const xField = component.xField ?? component.x;
 const yField = component.yField ?? component.y;
 const xs = unique(rows.map((row) => category(row[xField])));
 const seriesNames = component.series
  ? unique(rows.map((row) => category(row[component.series])))
  : [component.label];
 const points = new Map(
  rows.map((row) => [
   JSON.stringify([
    category(row[xField]),
    component.series ? category(row[component.series]) : component.label,
   ]),
   row,
  ]),
 );
 const series = seriesNames.map((name) => {
  const item = {
   name,
   type: component.type === "area" ? "line" : component.type,
   data: xs.map((x) => {
    const row = points.get(JSON.stringify([x, name]));
    return row
     ? withPayload(row, { value: chartNumber(row[yField]) })
     : null;
   }),
  };
  if (component.type === "line" || component.type === "area")
   item.connectNulls = false;
  if (component.type === "area") item.areaStyle = {};
  return item;
 });
 const annotationData = (component.annotations ?? [])
  .filter(({ at }) => xs.length && at >= xs[0] && at <= xs[xs.length - 1])
  .map(({ at, label }) => ({ xAxis: at, label: { formatter: label } }));
 if (annotationData.length && series.length)
  series[0].markLine = { symbol: "none", data: annotationData };
 const horizontal =
  component.type === "bar" && component.orientation === "horizontal";
 return {
  animation: false,
  aria: { enabled: true },
  tooltip: { trigger: "axis" },
  legend: component.series ? {} : undefined,
  grid: { containLabel: true },
  xAxis: horizontal
   ? { type: "value", name: component.label }
   : { type: "category", data: xs },
  yAxis: horizontal
   ? { type: "category", data: xs }
   : { type: "value", name: component.label },
  series,
 };
}

function chartRowLabel(component, row) {
 const metric = [
  "heatmap",
  "pie",
  "donut",
  "treemap",
  "sankey",
  "gauge",
 ].includes(component.type)
  ? component.value
  : component.type === "boxplot"
    ? component.median
    : (component.yField ?? component.y);
 const categories =
  component.type === "heatmap"
   ? [component.xField ?? component.x, component.yField ?? component.y]
   : ["pie", "donut", "treemap"].includes(component.type)
     ? [component.name]
     : component.type === "sankey"
       ? [component.source, component.target]
       : component.type === "gauge"
         ? []
         : [
            component.xField ?? component.x,
            ...(component.series ? [component.series] : []),
           ];
 const prefix = categories.map((field) => category(row[field])).join(" / ");
 return `${prefix ? `${prefix}: ` : ""}${formatValue(row[metric])}`;
}

function interactionField(component) {
 if (["pie", "donut", "treemap"].includes(component.type))
  return component.name;
 if (component.type === "sankey") return component.source;
 return component.xField ?? component.x;
}

async function selectDimension(
 root,
 config,
 controller,
 section,
 value,
 modifier,
 emittedDimension,
 emittedAction,
) {
 const component = config.layout.find(
  ({ id }) => section?.id === `component-${id}`,
 );
 if (!component) return;
 await applyMarkSelection(
  root,
  config,
  controller,
  section,
  [{ field: interactionField(component), value, dimension: emittedDimension }],
  modifier,
  emittedAction,
 );
}

/**
 * Commit one clicked mark's typed field values together with all pending
 * filter control edits in a single requested revision. Only declared,
 * compatible dimension mappings update shared filters; everything else
 * stays local with a visible indication next to its component.
 */
async function applyMarkSelection(
 root,
 config,
 controller,
 section,
 pairs,
 modifier,
 action,
) {
 const component = config.layout.find(
  ({ id }) => section?.id === `component-${id}`,
 );
 if (!component || !pairs?.length) return;
 const pending = readFilters(root, config.filters);
 const byDimension = new Map();
 const unmatched = [];
 for (const pair of pairs) {
  const dimension =
   pair.dimension ??
   component.selectionDimensions?.[pair.field] ??
   (pair.field === interactionField(component)
    ? component.interactionDimension
    : undefined);
  const candidates = dimension
   ? config.filters.filter(
      (entry) => entry.dimension && entry.dimension === dimension,
     )
   : [];
  const filter =
   candidates.length === 1 && filterAcceptsValue(config, candidates[0], pair.value)
    ? candidates[0]
    : null;
  if (!filter) {
   unmatched.push(pair);
   continue;
  }
  const entry = byDimension.get(dimension);
  if (entry) entry.pairs.push(pair);
  else byDimension.set(dimension, { filter, pairs: [pair] });
 }
 const changes = {};
 for (const { filter, pairs: dimensionPairs } of byDimension.values()) {
  // Duplicate or contradictory values for one dimension never silently
  // change its shared filter; every pair of that dimension stays local.
  if (dimensionPairs.length !== 1) {
   unmatched.push(...dimensionPairs);
   continue;
  }
  changes[filter.id] = nextFilterValue(
   filter,
   pending[filter.id],
   dimensionPairs[0].value,
   modifier,
  );
 }
 const committed = Object.keys(changes).length > 0;
 if (committed) await controller.applyFilters({ ...pending, ...changes });
 if (!committed || unmatched.length) setLocalSelection(section, unmatched);
 applyTypedAction(root, action ?? component.action, pairs[0].value);
}

/** A mark value may drive a shared filter only when exactly one filter owns
 * the dimension and the value has the filter column's declared type. */
function filterAcceptsValue(config, filter, value) {
 if (value == null) return false;
 if (filter.kind === "date-range" || filter.kind === "numeric-range")
  return false;
 const source = config.data.sources.find(({ id }) => id === filter.source);
 const columnType = source?.schema?.[filter.column]?.type;
 const valueType =
  value instanceof Date ? "date" : typeof value === "bigint" ? "number" : typeof value;
 return (
  (columnType === "string" && valueType === "string") ||
  (columnType === "boolean" && valueType === "boolean") ||
  ((columnType === "integer" || columnType === "number") &&
   valueType === "number") ||
  ((columnType === "date" || columnType === "timestamp") &&
   valueType === "date")
 );
}

function nextFilterValue(filter, current, value, modifier) {
 if (filter.kind === "multi-select") {
  const selected = current ?? [];
  if (modifier)
   return selected.includes(value)
    ? selected.filter((item) => item !== value)
    : [...selected, value];
  return selected.length === 1 && selected[0] === value ? [] : [value];
 }
 return current === value ? null : value;
}

/** Toggle the visible local-only indication next to a component. */
function setLocalSelection(section, pairs) {
 const text = pairs.map(({ value }) => formatScalar(value)).join(",");
 section.dataset.localSelection =
  section.dataset.localSelection === text ? "" : text;
}

function openTab(root, id) {
 const selected = root.querySelector(`[data-tab-target="${id}"]`);
 if (!selected) return;
 const buttons = [
  ...selected.closest('[role="tablist"]').querySelectorAll('[role="tab"]'),
 ];
 for (const button of buttons) {
  const active = button === selected;
  button.setAttribute("aria-selected", String(active));
  for (const componentId of button.dataset.tabComponents
   .split(",")
   .filter(Boolean)) {
   const component = root.querySelector(`#component-${componentId}`);
   if (component) component.hidden = !active;
  }
 }
 root.querySelector("#dashboard").dataset.activeTab = id;
 requestAnimationFrame(() =>
  root.querySelectorAll(".chart").forEach((node) => charts.get(node)?.resize()),
 );
}

function applyTypedAction(root, action, value) {
 if (!action) return;
 const dashboard = root.querySelector("#dashboard");
 if (action.openTab) openTab(root, action.openTab);
 if (action.drilldown)
  dashboard.dataset.drilldown = `${action.drilldown}:${value}`;
}

async function applyBrush(config, controller, section) {
 const component = config.layout.find(
  ({ id }) => section.id === `component-${id}`,
 );
 const filter = config.filters.find(
  ({ dimension, kind }) =>
   dimension === component.brushDimension && kind === "date-range",
 );
 if (!filter) return;
 const from = section.querySelector("[data-brush-from]").value;
 const through = section.querySelector("[data-brush-through]").value;
 await controller.applyFilters({
  [`${filter.id}_from`]: from || null,
  [`${filter.id}_to`]: through ? addDays(through, 1) : null,
 });
}

function readFilters(root, filters) {
 const values = {};
 for (const filter of filters) {
  if (
   ["select", "single-select", "multi-select", "option-search"].includes(
    filter.kind,
   )
  ) {
   const selected = [
    ...root.querySelector(`#filter-${filter.id}`).selectedOptions,
   ].map((entry) => entry.featherbiValue);
   values[filter.id] =
    filter.kind === "multi-select" ? selected : (selected[0] ?? null);
  } else if (filter.kind === "date-range" || filter.kind === "numeric-range") {
   const from = root.querySelector(`#filter-${filter.id}-from`).value;
   const through = root.querySelector(`#filter-${filter.id}-through`).value;
   values[`${filter.id}_from`] =
    from === "" ? null : filter.kind === "numeric-range" ? Number(from) : from;
   values[`${filter.id}_to`] =
    through === ""
     ? null
     : filter.kind === "numeric-range"
       ? Number(through)
       : addDays(through, 1);
  } else if (filter.kind === "boolean") {
   const checked = root.querySelector(
    `input[name="filter-${filter.id}"]:checked`,
   );
   values[filter.id] = checked ? booleanChoice(checked.value) : null;
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
   .filter((source) => !source.remote)
   .map((source) => [
    source.id,
    root.querySelector(`#source-${source.id}`).files[0],
   ])
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

/**
 * Stable per-value option key; null (the "all" option) and bigints are
 * distinguishable and never collide with JSON-stringified values.
 * @param {string | number | boolean | bigint | Date | null | undefined} value
 */
function optionKey(value) {
 if (value == null) return "null";
 return typeof value === "bigint" ? `bigint:${value}` : JSON.stringify(value);
}

function optionLabel(value) {
 return value === "" ? "(empty)" : String(value);
}

/** Typed value (null/true/false) of a three-choice boolean control. */
function booleanChoice(value) {
 return value === "true" ? true : value === "false" ? false : null;
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
 if (value instanceof Date)
  return value.toISOString().replace("T", " ").replace("Z", "");
 return String(value);
}

function category(value) {
 return value == null
  ? "(missing)"
  : value === ""
    ? "(empty)"
    : formatScalar(value);
}

function chartNumber(value) {
 return value == null ? null : Number(value);
}

function unique(values) {
 return [...new Set(values)];
}

function debounce(key, action) {
 clearTimeout(debounceTimers.get(key));
 debounceTimers.set(
key,
setTimeout(() => Promise.resolve(action()).catch(() => {}), 250),
 );
}

function addDays(value, days) {
 const date = new Date(`${value}T00:00:00Z`);
 date.setUTCDate(date.getUTCDate() + days);
 return date.toISOString().slice(0, 10);
}

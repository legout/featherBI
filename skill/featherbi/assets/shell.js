export const manifest = { shell: 1 };
// featherBI default shell (contract v1, references/shell.md): the page chrome in DaisyUI markup. The renderer reaches it
// only through mount(); everything it paints arrives as plain values, every user gesture leaves as an action.
// Layout: the classic-bi design (spec 0006): header, section rail on the left when the config has sections, the tile
// canvas, and the filter panel docked on the right; below `lg` the rail lies on top and the panel is a disclosure.
// shortcut: every `page.design` name renders classic-bi, until plan 0006 task D2 adds the other three layouts.

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const svg = (tag, attributes, child) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (child) node.append(child);
  return node;
};
const NO_DATA_CLASS = "text-base-content/80";
const ICON = { class: "size-4", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.75", "stroke-linecap": "round" };
const sun = () => {
  const icon = svg("svg", { ...ICON, "aria-hidden": "true" }, svg("circle", { cx: 12, cy: 12, r: 4 }));
  icon.append(svg("path", { d: "M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" }));
  return icon;
};
const moon = () => svg("svg", { ...ICON, "stroke-linejoin": "round", "aria-hidden": "true" }, svg("path", { d: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" }));
const chevron = () => svg("svg", { ...ICON, "stroke-linejoin": "round", "aria-hidden": "true" }, svg("path", { d: "M6 9l6 6 6-6" }));
// Tile size → columns of the canvas's 12-column grid, by the canvas's own width (it is narrower than the window by the
// rail and the panel; at least 34rem while they are docked). `large` is `wide` with a taller chart or grid.
// Below `lg` the two grids of a group dissolve into its column, where each tile's `order` is its place in the config;
// from `lg` the KPIs have their own row above the other tiles.
const GRID = "max-lg:contents lg:grid lg:grid-cols-12 lg:gap-4";
const STACK = "flex flex-col gap-4";
const SPAN = { small: "col-span-12 @md:col-span-6 @4xl:col-span-3", medium: "col-span-12 @lg:col-span-6", large: "col-span-12", wide: "col-span-12" };
const RAIL = "flex flex-wrap gap-1 px-4 pt-4 sm:px-6 lg:sticky lg:top-0 lg:w-44 lg:shrink-0 lg:flex-col lg:flex-nowrap lg:self-start lg:py-6 lg:pr-0";
const RAIL_ITEM = "btn btn-sm btn-ghost h-auto min-h-8 py-1 text-left lg:justify-start";

export function mount(root, page, actions) {
  root.className = "flex min-h-screen flex-col"; // the docked panel reaches the bottom of a short page
  // Header: logo, title, Explore, "Data available until", theme toggle, subtitle and header line.
  const header = root.appendChild(el("header", "navbar flex-wrap bg-base-100 px-4 shadow-sm sm:px-6"));
  if (page.logo) header.append(Object.assign(el("img", "fb-logo"), { src: page.logo, alt: "" }));
  const h1 = header.appendChild(el("h1", "flex-1 text-lg font-semibold tracking-tight", page.title));
  const launcher = page.exploreTable == null ? null : header.appendChild(el("button", "btn btn-sm btn-ghost", "Explore"));
  if (launcher) {
    launcher.hidden = true;
    launcher.onclick = () => actions.openExplore();
  }
  const toggle = header.appendChild(el("label", "flex items-center gap-2"));
  const checkbox = Object.assign(el("input", "toggle toggle-sm theme-controller"), { type: "checkbox", id: "theme", value: "night" });
  checkbox.setAttribute("aria-label", "Dark theme");
  toggle.append(sun(), checkbox, moon());
  toggle.hidden = !page.canToggleTheme;
  checkbox.onchange = () => actions.theme(checkbox.checked);
  if (page.subtitle != null) header.append(el("p", "w-full text-base-content/80 text-sm", page.subtitle));
  if (page.headerLine != null) header.append(el("p", "w-full text-base-content/80 text-xs", page.headerLine));

  // In the DOM as on a wide screen: rail, canvas, panel. Below `lg` the panel moves above them as a disclosure.
  const frame = root.appendChild(el("div", "flex flex-1 flex-col lg:flex-row"));
  const main = frame.appendChild(el("main", `@container min-w-0 flex-1 ${STACK} p-4 sm:p-6`));
  const side = frame.appendChild(el("aside", "border-base-300 bg-base-100 max-lg:order-first max-lg:border-b lg:w-64 lg:shrink-0 lg:border-l"));
  side.setAttribute("aria-label", "Filters");
  const sideBody = side.appendChild(el("div", "flex flex-col gap-3 px-4 py-2 sm:px-6 lg:sticky lg:top-0 lg:max-h-screen lg:overflow-y-auto lg:px-4 lg:py-6"));
  const disclosure = sideBody.appendChild(el("button", "btn btn-sm btn-ghost w-full justify-between lg:hidden"));
  const disclosureLabel = disclosure.appendChild(el("span", "", "Filters"));
  const arrow = disclosure.appendChild(chevron());
  sideBody.append(el("h2", "text-sm font-semibold max-lg:hidden", "Filters"));
  const bar = sideBody.appendChild(el("div", "grid grid-cols-2 gap-3 max-lg:hidden max-lg:pb-2 lg:grid-cols-1"));
  bar.id = "filters";
  disclosure.type = "button";
  disclosure.setAttribute("aria-controls", bar.id);
  disclosure.setAttribute("aria-expanded", "false");
  disclosure.onclick = () => {
    const open = bar.classList.toggle("max-lg:hidden") === false;
    disclosure.setAttribute("aria-expanded", open);
    arrow.classList.toggle("rotate-180", open);
  };
  const notice = (kind, message) => {
    const box = el("div", kind === "warning" ? "alert alert-warning" : "alert alert-error", message);
    box.setAttribute("role", "alert");
    main.prepend(box);
    return box;
  };

  // Groups: the page's two grids without sections; a titled group (stack) or a tab panel (tabs) per section.
  const tabbed = page.layout === "tabs";
  const level = page.layout === "stack" ? 3 : 2;
  const tabs = [];
  const panels = [];
  let openTab = 1;
  const slots = [];
  if (page.layout === "flat") {
    const kpis = main.appendChild(el("section", GRID));
    const tiles = main.appendChild(el("section", GRID));
    [kpis.id, tiles.id] = ["kpis", "tiles"];
    kpis.setAttribute("aria-label", "Key figures");
    tiles.setAttribute("aria-label", "Charts and notes");
    slots.push({ kpis, tiles });
  } else {
    // The section rail: the tab list (tabs), or buttons that jump to a section (stack).
    const rail = el(tabbed ? "div" : "nav", RAIL);
    rail.setAttribute("aria-label", "Sections");
    main.before(rail);
    if (tabbed) {
      rail.setAttribute("role", "tablist");
      // Arrow keys move to the neighbouring tab (around the ends; the rail is a column or a row), Home and End to the first and last.
      rail.onkeydown = event => {
        const [back, on] = [openTab - 1 || tabs.length, (openTab % tabs.length) + 1];
        const to = { ArrowLeft: back, ArrowUp: back, ArrowRight: on, ArrowDown: on, Home: 1, End: tabs.length }[event.key];
        if (!to) return;
        event.preventDefault();
        actions.tab(to);
      };
    }
    for (const [s, group] of page.groups.entries()) {
      const panel = el("section", STACK);
      const label = tabbed ? el("button", "", group.title) : el("h2", "text-base font-semibold tracking-tight", group.title);
      label.id = `section-${s}-title`;
      panel.setAttribute("aria-labelledby", label.id);
      if (tabbed) {
        panel.id = `section-${s}`;
        panel.setAttribute("role", "tabpanel");
        label.type = "button";
        label.setAttribute("role", "tab");
        label.setAttribute("aria-controls", panel.id);
        label.onclick = () => actions.tab(s + 1);
        rail.append(label);
        tabs.push(label);
      } else {
        if (s) panel.style.marginTop = "2rem"; // more room above a section title than under it
        panel.append(label);
        label.tabIndex = -1;
        const jump = rail.appendChild(el("button", RAIL_ITEM, group.title));
        jump.type = "button";
        // Not a link: the URL hash is the filter state.
        jump.onclick = () => {
          label.focus({ preventScroll: true });
          panel.scrollIntoView();
        };
      }
      // A section's KPIs sit in their own row at its top, as on a page without sections.
      const has = kpi => group.tiles.some(tile => (tile.type === "kpi") === kpi);
      slots.push({ kpis: has(true) ? panel.appendChild(el("div", GRID)) : null, tiles: has(false) ? panel.appendChild(el("div", GRID)) : null });
      main.append(panel);
      panels.push(panel);
    }
  }

  // Tiles: a KPI card or a card around the renderer's host, each with one handle in config order.
  const handles = [];
  let index = 0;
  for (const [s, group] of page.groups.entries()) {
    for (const tile of group.tiles) {
      const i = index++;
      const kpi = tile.type === "kpi";
      const box = el("div", `${kpi ? "stat rounded-box" : "card"} bg-base-100 shadow-sm ${SPAN[tile.size] ?? SPAN.medium}`);
      box.style.order = i + 1; // after the group's title and the page's alerts
      const height = tile.size === "large" ? "h-80 @3xl:h-[28rem]" : "h-80";
      const title = el(kpi ? "div" : `h${level}`, kpi ? "stat-title text-base-content/80" : "card-title text-sm font-medium text-base-content/80", tile.title);
      title.id = `tile-${i}-title`;
      box.setAttribute("role", "group");
      box.setAttribute("aria-labelledby", title.id);
      let error = null; // one alert per tile, in today's place for a tile failure: the top of the page
      const common = patch => {
        if ("title" in patch) title.textContent = patch.title;
        if ("error" in patch) {
          if (patch.error == null) error = (error?.remove(), null);
          else if (error) error.textContent = patch.error;
          else error = notice("error", patch.error);
        }
        if (patch.busy === true) box.setAttribute("aria-busy", "true");
      };
      if (kpi) {
        const value = el("div", "stat-value skeleton w-40 text-transparent tabular-nums", "0");
        const delta = el("div", "stat-desc text-sm text-base-content/80 tabular-nums");
        box.append(title, value, delta);
        if (tile.note != null) box.append(el("div", "text-xs text-base-content/80", tile.note));
        const line = svg("polyline", { fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" });
        if (tile.hasSpark) box.append(svg("svg", { class: "mt-1 h-8 w-full text-primary", viewBox: "0 0 100 24", preserveAspectRatio: "none", "aria-hidden": "true" }, line));
        slots[s].kpis.append(box);
        handles.push({
          host: null,
          update(patch) {
            common(patch);
            if (patch.kpi) {
              value.className = "stat-value tabular-nums";
              value.textContent = patch.kpi.value;
              delta.textContent = patch.kpi.delta;
              line.setAttribute("points", patch.kpi.points);
            }
            if (patch.busy === false) box.removeAttribute("aria-busy");
          },
        });
        continue;
      }
      const inner = el("div", "card-body gap-3 p-4");
      const body = el("div", { echarts: `skeleton relative ${height}`, pivot: "w-full text-sm", table: `${height} w-full` }[tile.type] ?? "max-w-prose space-y-2 text-sm leading-relaxed");
      // The host is the renderer's: a chart and a pivot table get their own node, a grid and a text tile the body itself.
      let host = body;
      let empty = null;
      if (tile.type === "echarts") {
        host = body.appendChild(el("div", "size-full"));
        empty = body.appendChild(el("p", `absolute inset-0 grid place-items-center text-sm ${NO_DATA_CLASS}`));
      } else if (tile.type === "pivot") {
        body.style.overflowX = "auto";
        host = body.appendChild(el("div", ""));
        empty = body.appendChild(el("p", NO_DATA_CLASS));
      }
      if (empty) empty.hidden = true;
      inner.append(title, body);
      box.append(inner);
      slots[s].tiles.append(box);
      handles.push({
        host,
        update(patch) {
          common(patch);
          if (empty && "empty" in patch) {
            empty.hidden = patch.empty == null;
            empty.textContent = patch.empty ?? "";
          }
          if (patch.busy === false) {
            body.classList.remove("skeleton");
            box.removeAttribute("aria-busy");
          }
        },
      });
    }
  }

  // Explore: the launcher in the header, a modal dialog with the renderer's viewer host.
  let dialog = null;
  let exploreHost = null;
  if (launcher) {
    dialog = root.appendChild(el("dialog", "rounded-box bg-base-100 shadow-sm"));
    dialog.setAttribute("aria-label", `Explore ${page.exploreTable}`);
    dialog.style.cssText = "width:95vw;height:90vh;max-width:none;max-height:none;margin:auto;padding:0"; // preflight drops the dialog's centring
    const close = el("button", "btn btn-sm btn-ghost", "Close");
    close.onclick = () => actions.closeExplore();
    dialog.oncancel = event => {
      event.preventDefault();
      actions.closeExplore();
    };
    const head = el("div", "flex items-center gap-3 px-4");
    head.append(el("h2", "flex-1 text-sm font-semibold", `Explore: ${page.exploreTable}`), close);
    exploreHost = el("div", "");
    exploreHost.style.height = "calc(100% - 3rem)";
    dialog.append(head, exploreHost);
  }

  let until = null;
  let progress = null;
  return {
    tiles: handles,
    exploreHost,
    filters({ dims, from, to }) {
      bar.replaceChildren();
      const active = Object.keys(dims).length;
      disclosureLabel.textContent = active ? `Filters (${active})` : "Filters"; // the closed panel still says that filters apply
      const field = (label, control) => {
        const wrap = el("label", "flex min-w-0 flex-col gap-1 text-xs");
        wrap.append(el("span", "text-base-content/80", label), control);
        bar.append(wrap);
      };
      for (const { name, options } of page.dimensions) {
        const select = el("select", "select select-sm w-full");
        select.append(new Option("All", ""));
        for (const v of options) select.append(new Option(v, v));
        // By position, not by DOM string: an option may be "" or print like another value.
        select.selectedIndex = Object.hasOwn(dims, name) ? options.findIndex(v => Object.is(v, dims[name])) + 1 : 0;
        select.onchange = () => actions.dim(name, select.selectedIndex === 0 ? null : options[select.selectedIndex - 1]);
        field(name, select);
      }
      if (page.hasDate) {
        for (const [key, value] of [["from", from], ["to", to]]) {
          const input = el("input", "input input-sm w-full");
          input.type = "date";
          input.value = value ?? "";
          input.onchange = () => actions.date(key, input.value || null);
          field(key === "from" ? "From" : "To", input);
        }
      }
      const chips = el("div", "col-span-full flex flex-wrap items-center gap-2 empty:hidden");
      chips.setAttribute("aria-label", "Active filters");
      for (const [name, value] of Object.entries(dims)) {
        const chip = el("span", "badge badge-neutral gap-1", `${name}: ${value}`);
        const x = el("button", "cursor-pointer", "×");
        x.setAttribute("aria-label", `Clear ${name}`);
        x.onclick = () => actions.dim(name, null);
        chip.append(x);
        chips.append(chip);
      }
      const reset = el("button", "btn btn-sm col-span-full", "Reset");
      reset.onclick = () => actions.reset();
      bar.append(chips, reset);
    },
    tab(n, focus) {
      if (!tabbed) return;
      openTab = n;
      for (const [s, tab] of tabs.entries()) {
        const open = s === n - 1;
        panels[s].hidden = !open;
        tab.setAttribute("aria-selected", open);
        tab.tabIndex = open ? 0 : -1; // roving focus: the tab list is one stop in the page's Tab order
        tab.className = `${RAIL_ITEM}${open ? " bg-base-100 shadow-sm" : " text-base-content/80"}`;
      }
      if (focus === true) tabs[n - 1].focus();
    },
    theme(dark) {
      checkbox.checked = dark;
    },
    explore(phase) {
      if (!launcher) return;
      launcher.hidden = phase === "hidden";
      launcher.disabled = phase === "loading";
      if (phase === "loading" || phase === "open") {
        if (!dialog.open) dialog.showModal();
      } else if (dialog.open) dialog.close();
      // The previous open's rows stay hidden until this open's view is drawn; laid out, so the grid redraws.
      exploreHost.style.visibility = phase === "open" ? "visible" : "hidden";
    },
    remote(text, loading) {
      if (text == null) until = (until?.remove(), null);
      else {
        until ??= el("p", "px-3 text-right text-xs text-base-content/80");
        until.textContent = text;
        if (!until.isConnected) (launcher ?? h1).after(until);
      }
      if (loading == null) progress = (progress?.box.remove(), null);
      else {
        if (!progress) {
          progress = { box: el("div", "space-y-1"), label: el("p", "text-sm text-base-content/80 tabular-nums"), bar: el("progress", "progress progress-primary w-full") };
          progress.bar.setAttribute("aria-label", "Loading data");
          progress.box.append(progress.label, progress.bar);
          main.prepend(progress.box);
        }
        const mb = bytes => (bytes / 2 ** 20).toFixed(1);
        progress.label.textContent = `Loading data ${mb(loading.loaded)} / ${mb(loading.total)} MB`;
        progress.bar.max = loading.total;
        progress.bar.value = loading.loaded;
      }
    },
    alert(kind, message) {
      notice(kind, message);
    },
  };
}

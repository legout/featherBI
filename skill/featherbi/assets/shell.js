export const manifest = { shell: 1 };
// featherBI default shell (contract v1, references/shell.md): the page chrome in DaisyUI markup. The renderer reaches it
// only through mount(); everything it paints arrives as plain values, every user gesture leaves as an action.

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

export function mount(root, page, actions) {
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

  const main = root.appendChild(el("main", "mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6"));
  const bar = main.appendChild(el("section", "flex flex-wrap items-end gap-3"));
  bar.id = "filters";
  bar.setAttribute("aria-label", "Filters");
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
  const KPIS = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4";
  const TILES = "grid grid-cols-1 gap-4 lg:grid-cols-2";
  const slots = [];
  if (page.layout === "flat") {
    const kpis = main.appendChild(el("section", KPIS));
    const tiles = main.appendChild(el("section", TILES));
    [kpis.id, tiles.id] = ["kpis", "tiles"];
    kpis.setAttribute("aria-label", "Key figures");
    tiles.setAttribute("aria-label", "Charts and notes");
    slots.push({ kpis, tiles });
  } else {
    const tablist = el("div", "flex flex-wrap gap-1");
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Sections");
    // Arrow keys move to the neighbouring tab (around the ends), Home and End to the first and last.
    tablist.onkeydown = event => {
      const to = { ArrowLeft: openTab - 1 || tabs.length, ArrowRight: (openTab % tabs.length) + 1, Home: 1, End: tabs.length }[event.key];
      if (!to) return;
      event.preventDefault();
      actions.tab(to);
    };
    if (tabbed) main.append(tablist);
    for (const [s, group] of page.groups.entries()) {
      const panel = el("section", "space-y-4");
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
        tablist.append(label);
        tabs.push(label);
      } else {
        if (s) panel.style.marginTop = "2rem"; // more room above a section title than under it
        panel.append(label);
      }
      // A section's KPIs sit in their own row at its top, as on a page without sections.
      const has = kpi => group.tiles.some(tile => (tile.type === "kpi") === kpi);
      slots.push({ kpis: has(true) ? panel.appendChild(el("div", KPIS)) : null, tiles: has(false) ? panel.appendChild(el("div", TILES)) : null });
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
      const box = el("div", kpi ? "stat rounded-box bg-base-100 shadow-sm" : "card bg-base-100 shadow-sm");
      const title = el(kpi ? "div" : `h${level}`, kpi ? "stat-title text-base-content/80" : "card-title text-sm font-medium text-base-content/80", tile.title);
      title.id = `tile-${i}-title`;
      box.setAttribute("role", "group");
      box.setAttribute("aria-labelledby", title.id);
      let errors = [];
      const common = patch => {
        if ("title" in patch) title.textContent = patch.title;
        if ("error" in patch) {
          if (patch.error == null) errors = (errors.forEach(e => e.remove()), []);
          else errors.push(notice("error", patch.error)); // today's place for a tile failure: an alert at the top of the page
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
      const body = el("div", { echarts: "skeleton relative h-80", pivot: "w-full text-sm", table: "h-80 w-full" }[tile.type] ?? "max-w-prose space-y-2 text-sm leading-relaxed");
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
      const field = (label, control) => {
        const wrap = el("label", "flex flex-col gap-1 text-xs");
        wrap.append(el("span", "text-base-content/80", label), control);
        bar.append(wrap);
      };
      for (const { name, options } of page.dimensions) {
        const select = el("select", "select select-sm");
        select.append(new Option("All", ""));
        for (const v of options) select.append(new Option(v, v));
        select.value = Object.hasOwn(dims, name) ? String(dims[name]) : "";
        select.onchange = () => actions.dim(name, select.value === "" ? null : options.find(v => String(v) === select.value));
        field(name, select);
      }
      if (page.hasDate) {
        for (const [key, value] of [["from", from], ["to", to]]) {
          const input = el("input", "input input-sm");
          input.type = "date";
          input.value = value ?? "";
          input.onchange = () => actions.date(key, input.value || null);
          field(key === "from" ? "From" : "To", input);
        }
      }
      const chips = el("div", "flex flex-wrap items-center gap-2");
      chips.setAttribute("aria-label", "Active filters");
      for (const [name, value] of Object.entries(dims)) {
        const chip = el("span", "badge badge-neutral gap-1", `${name}: ${value}`);
        const x = el("button", "cursor-pointer", "×");
        x.setAttribute("aria-label", `Clear ${name}`);
        x.onclick = () => actions.dim(name, null);
        chip.append(x);
        chips.append(chip);
      }
      const reset = el("button", "btn btn-sm btn-ghost", "Reset");
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
        tab.className = `btn btn-sm btn-ghost${open ? " bg-base-100 shadow-sm" : " text-base-content/80"}`;
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

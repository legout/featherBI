export const manifest = { shell: 1 };

export function mount(root, page, actions) {
  const el = (tag, parent, text) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    parent.append(node);
    return node;
  };
  const header = el('header', root);
  el('h1', header, page.title);
  el('div', header, 'Plain shell');
  if (page.logo) { const img = el('img', header); img.src = page.logo; img.alt = ''; }
  if (page.subtitle) el('div', header, page.subtitle);
  if (page.headerLine) el('div', header, page.headerLine);
  const theme = el('input', header); theme.type = 'checkbox'; theme.setAttribute('aria-label', 'Dark theme');
  theme.hidden = !page.canToggleTheme;
  theme.onchange = () => actions.theme(theme.checked);
  const launcher = el('button', header, 'Explore'); launcher.onclick = () => actions.openExplore();
  const main = el('main', root);
  const bar = el('div', main);
  const selects = new Map();
  for (const dimension of page.dimensions) {
    const label = el('label', bar, dimension.name);
    const select = el('select', label);
    el('option', select, 'All').value = '';
    dimension.options.forEach((value, i) => { el('option', select, String(value)).value = String(i + 1); });
    select.onchange = () => actions.dim(dimension.name, select.selectedIndex ? dimension.options[select.selectedIndex - 1] : null);
    selects.set(dimension.name, { select, options: dimension.options });
  }
  const dates = {};
  if (page.hasDate) for (const name of ['from', 'to']) {
    const label = el('label', bar, name === 'from' ? 'From' : 'To');
    const input = el('input', label); input.type = 'date';
    input.onchange = () => actions.date(name, input.value || null);
    dates[name] = input;
  }
  const chips = el('div', bar); chips.setAttribute('aria-label', 'Active filters');
  const reset = el('button', bar, 'Reset'); reset.onclick = () => actions.reset();
  const tablist = el('div', main); tablist.setAttribute('role', 'tablist'); tablist.hidden = page.layout !== 'tabs';
  const tabs = [], panels = [], tiles = [];
  page.groups.forEach((group, index) => {
    const tab = el('button', tablist, group.title || ''); tab.setAttribute('role', 'tab');
    tab.id = `plain-tab-${index}`; tab.setAttribute('aria-controls', `plain-panel-${index}`);
    tab.onclick = () => actions.tab(index + 1);
    tab.onkeydown = event => {
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % page.groups.length;
      else if (event.key === 'ArrowLeft') next = (index + page.groups.length - 1) % page.groups.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = page.groups.length - 1;
      else return;
      event.preventDefault(); actions.tab(next + 1);
    };
    tabs.push(tab);
    const panel = el('section', main); panels.push(panel);
    if (page.layout === 'tabs') { panel.id = `plain-panel-${index}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); }
    else if (group.title) el('h2', panel, group.title);
    group.tiles.forEach(tile => {
      const card = el('div', panel); card.setAttribute('role', 'group'); card.setAttribute('aria-label', tile.title);
      const title = el('h2', card, tile.title);
      const value = tile.type === 'kpi' ? el('div', card) : null;
      const delta = value ? el('div', card) : null;
      const spark = value && tile.hasSpark ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : null;
      const line = spark ? document.createElementNS('http://www.w3.org/2000/svg', 'polyline') : null;
      if (spark) { spark.setAttribute('viewBox', '0 0 100 24'); spark.append(line); card.append(spark); }
      if (tile.note) el('div', card, tile.note);
      const error = el('div', card), empty = el('div', card);
      const host = value ? null : el('div', card);
      if (host) { host.style.width = '100%'; host.style.height = '320px'; }
      tiles.push({ host, update(patch) {
        if ('title' in patch) title.textContent = patch.title;
        if ('busy' in patch) card.setAttribute('aria-busy', String(patch.busy));
        if ('error' in patch) error.textContent = patch.error || '';
        if ('empty' in patch) empty.textContent = patch.empty || '';
        if (patch.kpi && value) { value.textContent = patch.kpi.value; delta.textContent = patch.kpi.delta; if (line) line.setAttribute('points', patch.kpi.points); }
      } });
    });
  });
  const dialog = el('dialog', root);
  el('h2', dialog, 'Explore');
  const close = el('button', dialog, 'Close'); close.onclick = () => actions.closeExplore();
  dialog.oncancel = event => { event.preventDefault(); actions.closeExplore(); };
  const exploreHost = page.exploreTable ? el('div', dialog) : null;
  if (exploreHost) { exploreHost.style.width = '80vw'; exploreHost.style.height = '60vh'; }
  const remote = el('div', main), alerts = el('div', main);
  return {
    tiles, exploreHost,
    filters({ dims, from, to }) {
      chips.replaceChildren();
      for (const [name, { select, options }] of selects) {
        const i = Object.hasOwn(dims, name) ? options.findIndex(value => Object.is(value, dims[name])) : -1;
        select.selectedIndex = i + 1;
        if (i >= 0) { const clear = el('button', chips, `${name}: ${String(options[i])} ×`); clear.setAttribute('aria-label', `Clear ${name}`); clear.onclick = () => actions.dim(name, null); }
      }
      if (dates.from) dates.from.value = from || '';
      if (dates.to) dates.to.value = to || '';
    },
    tab(n, focus) {
      if (page.layout !== 'tabs') return;
      tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === n - 1)); tab.tabIndex = i === n - 1 ? 0 : -1; panels[i].hidden = i !== n - 1; });
      if (focus) tabs[n - 1].focus();
    },
    theme(dark) { theme.checked = dark; },
    explore(phase) {
      launcher.hidden = phase === 'hidden'; launcher.disabled = phase === 'loading';
      if (phase === 'loading' || phase === 'open') { if (!dialog.open) dialog.showModal(); }
      else if (dialog.open) dialog.close();
      if (exploreHost) exploreHost.style.visibility = phase === 'open' ? 'visible' : 'hidden';
    },
    remote(until, progress) {
      remote.replaceChildren();
      if (until) el('div', remote, until);
      if (progress) { el('div', remote, `Loading data ${(progress.loaded / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} MB`); const bar = el('progress', remote); bar.max = progress.total; bar.value = progress.loaded; }
    },
    alert(kind, message) { const notice = el('div', alerts, message); notice.setAttribute('role', 'alert'); },
  };
}

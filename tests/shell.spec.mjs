// Spec 0005 r3 acceptance 9: an independent shell, exercised through its controls and real charts.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'skill/featherbi/scripts/featherbi.mjs');
const config = path.join(root, 'fixtures/hand/acceptance.yaml');
const fixture = path.join(root, 'tests/fixtures/plain-shell.js');
const tile = (page, name) => page.getByRole('group', { name, exact: true });

async function clickEU(page) {
  const chart = tile(page, 'Revenue vs target by region');
  await expect(chart).not.toHaveAttribute('aria-busy', 'true');
  const img = chart.getByRole('img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate(node => [...node.querySelectorAll('canvas')].some(c => {
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
    return false;
  }))).toBe(true);
  await img.scrollIntoViewIfNeeded();
  const point = await img.evaluate(async node => {
    const { charts } = JSON.parse(document.getElementById('dashboard').textContent);
    const echarts = await import(charts.url);
    const box = node.getBoundingClientRect();
    const [x, y] = echarts.getInstanceByDom(node).convertToPixel({ seriesIndex: 0 }, ['EU', 400]);
    return { x: box.x + x - 20, y: box.y + y };
  });
  await page.mouse.click(point.x, point.y);
}

for (const offline of [false, true]) {
  test(`alternate shell: hand journey${offline ? ' offline' : ''}`, async ({ page }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-shell-'));
    try {
      const shell = path.join(dir, 'shell.js'), html = path.join(dir, 'dashboard.html');
      fs.copyFileSync(fixture, shell);
      execFileSync(process.execPath, [cli, 'build', config, '--shell', shell, '--out', html, ...(offline ? ['--offline'] : [])], { cwd: root, stdio: 'pipe' });
      fs.unlinkSync(shell); // The viewer cannot load the original file.
      const requests = [], errors = [];
      if (offline) await page.route(target => !target.href.startsWith('file:'), route => { requests.push(route.request().url()); return route.abort(); });
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(pathToFileURL(html).href);
      await expect(page.getByText('Plain shell', { exact: true })).toBeVisible();
      const revenue = amount => expect(tile(page, 'Revenue').getByText(amount, { exact: true })).toBeVisible();
      const explore = async count => {
        await page.getByRole('button', { name: 'Explore', exact: true }).click();
        const viewer = page.locator('perspective-viewer');
        await expect(viewer).toBeVisible();
        await expect.poll(() => viewer.evaluate(async el => (await el.getView()).num_rows())).toBe(count);
      };
      await revenue('$2,260.50');
      await clickEU(page);
      await revenue('$850.00');
      await expect(tile(page, 'Sales rows')).toContainText('6 rows (filtered)');
      await expect(tile(page, 'Region × month').getByRole('row', { name: /^EU/ }).getByRole('cell').nth(1)).toHaveText('$300.00');
      expect(new URL(page.url()).hash).toBe('#region=EU');
      await explore(6);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByLabel('From').fill('2025-02-01');
      await page.getByLabel('To').fill('2025-02-28');
      await revenue('$300.00');
      await explore(2);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      await revenue('$2,260.50');
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

for (const [name, contents] of [
  ['missing', null],
  ['no declaration', '// not a manifest\nexport const manifest = { shell: 1 };\nexport function mount() {}\n'],
  ['wrong version', 'export const manifest = { shell: 2 };\n'],
]) {
  test(`rejects ${name} shell without creating or replacing output`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bad-shell-'));
    try {
      const shell = path.join(dir, 'shell.js'), out = path.join(dir, 'dashboard.html');
      if (contents !== null) fs.writeFileSync(shell, contents);
      for (const existing of [false, true]) {
        if (existing) fs.writeFileSync(out, 'keep this file');
        const result = spawnSync(process.execPath, [cli, 'build', config, '--shell', shell, '--out', out], { cwd: root, encoding: 'utf8' });
        expect(result.status).not.toBe(0);
        expect(result.stderr + result.stdout).toContain(shell);
        expect(result.stderr + result.stdout).toContain('export const manifest = { shell: 1 };');
        if (existing) expect(fs.readFileSync(out, 'utf8')).toBe('keep this file');
        else expect(fs.existsSync(out)).toBe(false);
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

// Review of #143: contract paths the hand journey does not reach. Each builds the hand fixture with a variant of the plain
// shell (its declaration line kept first) or with the default shell, and drives the page through its widgets.
function variant(dir, edit, { configFile = config, extra = [] } = {}) {
  const shell = path.join(dir, 'shell.js'), html = path.join(dir, 'dashboard.html');
  fs.writeFileSync(shell, edit(fs.readFileSync(fixture, 'utf8')));
  execFileSync(process.execPath, [cli, 'build', configFile, '--shell', shell, '--out', html, ...extra], { cwd: root, stdio: 'pipe' });
  return pathToFileURL(html).href;
}
const revenueIs = (page, amount) => expect(tile(page, 'Revenue').getByText(amount, { exact: true })).toBeVisible();
const scratch = async run => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-review-'));
  try { await run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('a navigation while the shell module loads wins over the hash read before it', async ({ page }) => scratch(async dir => {
  // The module's own top-level code runs during the import: it stands in for a viewer navigating meanwhile, and it keeps
  // the import pending until that navigation's hashchange has been dispatched.
  const url = variant(dir, source => source.replace('\n', '\nlocation.hash = "#region=US";\nawait new Promise(resolve => addEventListener("hashchange", () => setTimeout(resolve, 50), { once: true }));\n'));
  await page.goto(url);
  await expect(tile(page, 'Revenue').getByText('$1,410.50', { exact: true })).toBeVisible(); // US hand total
  await expect(page.getByRole('combobox', { name: 'region' })).toHaveValue('2'); // the plain shell's option index of US
  expect(new URL(page.url()).hash).toBe('#region=US');
}));

test('a sparse tile handle array stops the page with the contract diagnostic on the root', async ({ page }) => scratch(async dir => {
  const url = variant(dir, source => source.replace('    tiles, exploreHost,', '    tiles: Object.assign(new Array(tiles.length), { 0: tiles[0] }), exploreHost,'));
  await page.goto(url);
  await expect(page.locator('#featherbi')).toHaveText(/^featherBI: this page's shell does not meet shell contract v1 \(tile 2 \(echarts\)/);
}));

test('a nonexistent day from a date control changes nothing', async ({ page }) => scratch(async dir => {
  await page.goto(variant(dir, source => source));
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await revenueIs(page, '$2,260.50');
  const from = page.getByLabel('From');
  await from.evaluate(input => { input.type = 'text'; }); // a custom control can send any text
  for (const day of ['2025-02-30', '2025-13-01']) { // a day past its month's end; a month that does not exist
    await from.fill(day);
    await from.dispatchEvent('change');
  }
  expect(errors).toEqual([]);
  await page.getByLabel('To').fill('2025-02-28'); // a real day still applies, with From unchanged
  await revenueIs(page, '$1,490.00'); // README: January 250.00 + 450.00, February 300.00 + 490.00
  expect(new URL(page.url()).hash).toBe('#date=2025-01-05..2025-02-28');
}));

test('the default shell keeps an empty-string option apart from All, in the bar and in the hash', async ({ page }) => scratch(async dir => {
  const yaml = path.join(dir, 'blank.yaml'), html = path.join(dir, 'blank.html');
  fs.writeFileSync(yaml, `title: Blank region
name: blank
sources:
  t:
    read: "(SELECT * FROM (VALUES ('', 1), ('EU', 2)) v(region, revenue))"
dims:
  region: {col: region}
explore: false
tiles:
  - { type: kpi, title: Revenue, sql: "SELECT SUM(revenue) AS value FROM t WHERE {{filters:t}}" }
`);
  execFileSync(process.execPath, [cli, 'build', yaml, '--out', html], { cwd: root, stdio: 'pipe' });
  await page.goto(pathToFileURL(html).href);
  await revenueIs(page, '3');
  const region = page.getByRole('combobox', { name: 'region' });
  await region.selectOption({ index: 1 }); // the "" option, after All
  await revenueIs(page, '1');
  expect(new URL(page.url()).hash).toBe('#region=');
  await page.reload();
  await revenueIs(page, '1');
  expect(await region.evaluate(select => select.selectedIndex)).toBe(1);
  await expect(page.getByRole('button', { name: 'Clear region' })).toBeVisible();
}));

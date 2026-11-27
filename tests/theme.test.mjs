// Themes at the CLI (spec 0003 r2): the default page is unchanged, every validation case stops the build, the contrast warning.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "skill/featherbi/scripts/featherbi.mjs");
const build = (args, cwd) => spawnSync(process.execPath, [cli, "build", ...args], { cwd, encoding: "utf8" });
const sha256 = text => crypto.createHash("sha256").update(text).digest("hex");

// A dashboard with `theme: <theme>` in a new folder; `files` are written next to it (null content: a folder). Without `data` its source does not
// exist, so a build that read a source before it checked the theme would fail on the source instead.
function project(theme, files = {}, { data = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-"));
  if (data) fs.copyFileSync(path.join(root, "fixtures/hand/sales.parquet"), path.join(dir, "sales.parquet"));
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), `title: Themed\ntheme: ${theme}\nsources:\n  sales:\n    read: "read_parquet('sales.parquet')"\ntiles:\n  - { type: kpi, title: Revenue, sql: "SELECT SUM(revenue) AS value FROM sales" }\n`);
  for (const [name, content] of Object.entries(files)) content === null ? fs.mkdirSync(path.join(dir, name)) : fs.writeFileSync(path.join(dir, name), content);
  return dir;
}
const LIGHT = 'light: { base-100: "#ffffff", base-content: "#1a1a1a" }\n';

// Spec 0003 acceptance 1 (defined in spec 0005 acceptance 1). The reference was captured from a build of main at 461142a,
// before the theme change, never from the new code: SHA-256 of the complete #dashboard JSON and of the CSS, and Chromium's
// accessibility tree under header and main after load. A later change that alters one of them on purpose captures its
// own reference. The JSON embeds the snapshot Parquet, whose bytes belong to the DuckDB version that wrote them: the
// reference is DuckDB 2.0.1's (the version CI pins). Under another DuckDB only `dataWithoutParquet` can be compared.
const MAIN = {
  data: "ae7b82e22690ebf1dd4f7aa7df0e1b4854a30c3ab69ebc4989e3e5a033c6e8bf",
  dataWithoutParquet: "d33fc4cad59a20da8ce37f46a05305b21fe0ace59940522db9fe22691a071a9a",
  css: "6f79513eadb3d6972f963213d96505efaea6d7445c3a5e4321bca30a2c0f8af7",
  header: '- banner:\n  - heading "Hand fixture" [level=1]\n  - button "Explore"\n  - checkbox "Dark theme"',
  main: '- main:\n  - region "Filters":\n    - text: region\n    - combobox "region":\n      - option "All" [selected]\n      - option "EU"\n      - option "US"\n    - text: channel\n    - combobox "channel":\n      - option "All" [selected]\n      - option "Online"\n      - option "Retail"\n    - text: From\n    - textbox "From": 2024-04-01\n    - text: To\n    - textbox "To": 2025-03-25\n    - button "Reset"\n  - region "Key figures":\n    - group "Revenue": Revenue $2,260.50\n  - region "Charts and notes"',
};

test("without `theme` the hand fixture renders the same page as main before themes", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-default-"));
  const browser = await chromium.launch();
  try {
    const out = path.join(dir, "hand.html");
    const r = build(["fixtures/hand/dashboard.yaml", "--out", out], root);
    assert.equal(r.status, 0, r.stderr);
    const html = fs.readFileSync(out, "utf8");
    const data = html.match(/<script type="application\/json" id="dashboard">([\s\S]*?)<\/script>/)[1];
    const duckdb = spawnSync("duckdb", ["-no-agent", "--version"], { encoding: "utf8" }).stdout.trim();
    if (duckdb.startsWith("v2.0.1 ")) assert.equal(sha256(data), MAIN.data, "complete #dashboard JSON");
    else {
      t.diagnostic(`DuckDB is ${duckdb}, not 2.0.1: the snapshot Parquet bytes were left out of the #dashboard comparison`);
      assert.equal(sha256(data.replace(/data:application\/octet-stream;base64,[A-Za-z0-9+/=]*/g, "")), MAIN.dataWithoutParquet, "#dashboard JSON");
    }
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
    assert.equal(styles.length, 1, "one <style>");
    assert.equal(sha256(styles[0][1]), MAIN.css, "CSS");

    const page = await browser.newPage();
    await page.goto(pathToFileURL(out).href);
    await page.getByText("$2,260.50", { exact: true }).waitFor();
    assert.equal(await page.locator("header").ariaSnapshot(), MAIN.header);
    assert.equal(await page.locator("main").ariaSnapshot(), MAIN.main);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Spec 0003 §Validation: [case, `theme:` value, files, the file and the key the error names].
const KB = 1024;
const INVALID = [
  ["unknown built-in name", "nope", {}, "nope", "theme"],
  ["file not found", "./missing.yaml", {}, "./missing.yaml", "theme"],
  ["unknown key", "./t.yaml", { "t.yaml": `${LIGHT}colours: 1\n` }, "./t.yaml", "colours"],
  ["unknown colour token", "./t.yaml", { "t.yaml": 'light: { brand: "#ffffff" }\n' }, "./t.yaml", "light.brand"],
  ["a colour that is not hex or oklch()", "./t.yaml", { "t.yaml": "dark: { primary: blue }\n" }, "./t.yaml", "dark.primary"],
  ["an oklch() colour with a malformed number", "./t.yaml", { "t.yaml": 'light: { primary: "oklch(60% .1.2 30)" }\n' }, "./t.yaml", "light.primary"],
  // CSS numbers need a digit after a decimal point: Chromium's CSS.supports("color", "oklch(100.% 0 0)") is false.
  ["an oklch() number that ends in its decimal point", "./t.yaml", { "t.yaml": 'light: { primary: "oklch(100.% 0 0)" }\n' }, "./t.yaml", "light.primary"],
  ["an oklch() colour with a channel missing", "./t.yaml", { "t.yaml": 'light: { primary: "oklch(60% .1)" }\n' }, "./t.yaml", "light.primary"],
  ["a hex colour of five digits", "./t.yaml", { "t.yaml": 'light: { primary: "#12345" }\n' }, "./t.yaml", "light.primary"],
  ["a palette colour that is not hex or oklch()", "./t.yaml", { "t.yaml": `${LIGHT}palette: ["#0b5fff", "rgb(1,2,3)"]\n` }, "./t.yaml", "palette[1]"],
  ["font file missing", "./t.yaml", { "t.yaml": `${LIGHT}font: { family: Acme Sans, file: ./a.woff2 }\n` }, "./t.yaml", "font.file"],
  ["font file of the wrong type", "./t.yaml", { "t.yaml": `${LIGHT}font: { family: Acme Sans, file: ./a.txt }\n`, "a.txt": "x" }, "./t.yaml", "font.file"],
  ["font file with a font suffix that holds no font", "./t.yaml", { "t.yaml": `${LIGHT}font: { family: Acme Sans, file: ./a.woff2 }\n`, "a.woff2": "<!doctype html><p>not a font</p>" }, "./t.yaml", "font.file"],
  ["font file larger than 500 KB", "./t.yaml", { "t.yaml": `${LIGHT}font: { family: Acme Sans, file: ./a.woff2 }\n`, "a.woff2": Buffer.alloc(501 * KB) }, "./t.yaml", "font.file"],
  ["logo missing", "./t.yaml", { "t.yaml": `${LIGHT}logo: ./logo.svg\n` }, "./t.yaml", "logo"],
  ["logo of the wrong type", "./t.yaml", { "t.yaml": `${LIGHT}logo: ./logo.jpg\n`, "logo.jpg": "x" }, "./t.yaml", "logo"],
  ["logo.png that holds an HTML page", "./t.yaml", { "t.yaml": `${LIGHT}logo: ./logo.png\n`, "logo.png": "<!doctype html><html><body>not an image</body></html>" }, "./t.yaml", "logo"],
  ["logo.svg that holds an HTML page", "./t.yaml", { "t.yaml": `${LIGHT}logo: ./logo.svg\n`, "logo.svg": "<!doctype html><html><body><svg></svg></body></html>" }, "./t.yaml", "logo"],
  ["logo.png that is a folder", "./t.yaml", { "t.yaml": `${LIGHT}logo: ./logo.png\n`, "logo.png": null }, "./t.yaml", "logo"],
  ["logo larger than 200 KB", "./t.yaml", { "t.yaml": `${LIGHT}logo: ./logo.png\n`, "logo.png": Buffer.alloc(201 * KB) }, "./t.yaml", "logo"],
];
for (const [name, theme, files, file, key] of INVALID) {
  test(`theme validation stops the build before any source is read and writes no HTML: ${name}`, () => {
    const dir = project(theme, files);
    try {
      const r = build(["dashboard.yaml"], dir);
      assert.equal(r.status, 1, r.stderr);
      assert.ok(r.stderr.startsWith(`featherbi: theme ${file}: ${key}: `), r.stderr);
      assert.equal(fs.existsSync(path.join(dir, "dist")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

// Every colour form CSS allows inside oklch() and as hex is accepted: [case, colour].
const VALID = [
  ["a signed hue", "oklch(60% .1 -30)"],
  ["a hue with a unit, an exponent and an alpha", "oklch(0.6 1e-1 0.5turn / 80%)"],
  ["hex with alpha", "#0b5fffcc"],
];
for (const [name, colour] of VALID) {
  test(`a theme colour builds: ${name}`, () => {
    const dir = project("./t.yaml", { "t.yaml": `light: { accent: "${colour}" }\n` }, { data: true });
    try {
      const r = build(["dashboard.yaml"], dir);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(path.join(dir, "dist", "themed.html")));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

// Spec 0003 acceptance 6 and §Contrast warning, on the pairs as the page paints them: text composited over its surface,
// tokens the file leaves out taken from the default theme. Oracles, WCAG 2.x by hand (L = ((c + 0.055) / 1.055)^2.4 per
// equal channel c, ratio = (L_hi + 0.05) / (L_lo + 0.05), white L = 1):
// - #999999: c = 0.6, L = 0.3185, 1.05 / 0.3685 = 2.85.
// - #0000 (transparent) on white paints white: 1.00.
// - #00000080 on white: alpha 128/255 leaves c = 127/255 = 0.4980, L = 0.2122, 1.05 / 0.2622 = 4.00.
// - oklch(0 0 0 / 50%) on white: c = 0.5, L = 0.2140, 1.05 / 0.2640 = 3.98.
// - oklch(100% 0 none): a missing hue counts as 0 and chroma is 0, so it is white; on white 1.05 / 1.05 = 1.00.
// - base-100 #fff0 is fully transparent, so the header shows the page's base-200 under it (templates/dashboard.html:
//   body bg-base-200, header bg-base-100): #000 text on #000 is 0.05 / 0.05 = 1.00.
// - the default light theme's own primary pair (DaisyUI winter), inherited by a file that sets neither token: Chromium
//   paints it as rgb(206,228,255) on rgb(0,105,255), 3.62 after 8-bit rounding; unrounded it is within 0.03 of that.
// [case, light tokens, the warnings: [pair, ratio]]. PRIMARY passes (#ffffff on #0b5fff is 5.13), so it adds no warning.
const PRIMARY = 'primary: "#0b5fff", primary-content: "#ffffff"';
const CONTRAST = [
  ["#999999 text on #ffffff", `base-100: "#ffffff", base-content: "#999999", ${PRIMARY}`, [["base-content on base-100", /2\.85:1/]]],
  ["fully transparent text", `base-100: "#ffffff", base-content: "#0000", ${PRIMARY}`, [["base-content on base-100", /1\.00:1/]]],
  ["half-transparent black text", `base-100: "#ffffff", base-content: "#00000080", ${PRIMARY}`, [["base-content on base-100", /4\.00:1/]]],
  ["half-transparent oklch() text", `base-100: "#ffffff", base-content: "oklch(0 0 0 / 50%)", ${PRIMARY}`, [["base-content on base-100", /3\.98:1/]]],
  ["white text written with a missing hue", `base-100: "#ffffff", base-content: "oklch(100% 0 none)", ${PRIMARY}`, [["base-content on base-100", /1\.00:1/]]],
  ["black text on a transparent surface over a black page", `base-100: "#fff0", base-200: "#000", base-content: "#000", ${PRIMARY}`, [["base-content on base-100", /1\.00:1/]]],
  ["an inherited pair the file does not set", 'base-100: "#ffffff", base-content: "#1a1a1a"', [["primary-content on primary", /3\.(59|6[0-5]):1/]]],
  ["pairs that pass", `base-100: "#ffffff", base-content: "#1a1a1a", ${PRIMARY}`, []],
];
for (const [name, tokens, expected] of CONTRAST) {
  test(`the build succeeds and warns about each pair below 4.5:1, with its ratio: ${name}`, () => {
    const dir = project("./t.yaml", { "t.yaml": `light: { ${tokens} }\n` }, { data: true });
    try {
      const r = build(["dashboard.yaml"], dir);
      assert.equal(r.status, 0, r.stderr);
      const warnings = r.stderr.split("\n").filter(line => line.includes("warning"));
      assert.equal(warnings.length, expected.length, r.stderr);
      expected.forEach(([pair, ratio], i) => {
        for (const part of ["./t.yaml", pair, "(light)"]) assert.ok(warnings[i].includes(part), warnings[i]);
        assert.match(warnings[i], ratio);
      });
      assert.ok(fs.existsSync(path.join(dir, "dist", "themed.html")));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

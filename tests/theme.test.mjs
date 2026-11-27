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

// A dashboard with `theme: <theme>` in a new folder; `files` are written next to it. Without `data` its source does not
// exist, so a build that read a source before it checked the theme would fail on the source instead.
function project(theme, files = {}, { data = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-"));
  if (data) fs.copyFileSync(path.join(root, "fixtures/hand/sales.parquet"), path.join(dir, "sales.parquet"));
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), `title: Themed\ntheme: ${theme}\nsources:\n  sales:\n    read: "read_parquet('sales.parquet')"\ntiles:\n  - { type: kpi, title: Revenue, sql: "SELECT SUM(revenue) AS value FROM sales" }\n`);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}
const LIGHT = 'light: { base-100: "#ffffff", base-content: "#1a1a1a" }\n';

// Spec 0003 acceptance 1 (defined in spec 0005 acceptance 1). The reference was captured from a build of main at 461142a,
// before the theme change, never from the new code: SHA-256 of the #dashboard JSON (without the Parquet bytes DuckDB
// writes) and of the CSS, and Chromium's accessibility tree under header and main after load. A later change that alters
// one of them on purpose captures its own reference.
const MAIN = {
  data: "d33fc4cad59a20da8ce37f46a05305b21fe0ace59940522db9fe22691a071a9a",
  css: "6f79513eadb3d6972f963213d96505efaea6d7445c3a5e4321bca30a2c0f8af7",
  header: '- banner:\n  - heading "Hand fixture" [level=1]\n  - button "Explore"\n  - checkbox "Dark theme"',
  main: '- main:\n  - region "Filters":\n    - text: region\n    - combobox "region":\n      - option "All" [selected]\n      - option "EU"\n      - option "US"\n    - text: channel\n    - combobox "channel":\n      - option "All" [selected]\n      - option "Online"\n      - option "Retail"\n    - text: From\n    - textbox "From": 2024-04-01\n    - text: To\n    - textbox "To": 2025-03-25\n    - button "Reset"\n  - region "Key figures":\n    - group "Revenue": Revenue $2,260.50\n  - region "Charts and notes"',
};

test("without `theme` the hand fixture renders the same page as main before themes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-default-"));
  const browser = await chromium.launch();
  try {
    const out = path.join(dir, "hand.html");
    const r = build(["fixtures/hand/dashboard.yaml", "--out", out], root);
    assert.equal(r.status, 0, r.stderr);
    const html = fs.readFileSync(out, "utf8");
    const data = html.match(/<script type="application\/json" id="dashboard">([\s\S]*?)<\/script>/)[1];
    assert.equal(sha256(data.replace(/data:application\/octet-stream;base64,[A-Za-z0-9+/=]*/g, "")), MAIN.data, "#dashboard JSON");
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
  ["a palette colour that is not hex or oklch()", "./t.yaml", { "t.yaml": `${LIGHT}palette: ["#0b5fff", "rgb(1,2,3)"]\n` }, "./t.yaml", "palette[1]"],
  ["font file missing", "./t.yaml", { "t.yaml": `${LIGHT}font: { family: Acme Sans, file: ./a.woff2 }\n` }, "./t.yaml", "font.file"],
  ["font file of the wrong type", "./t.yaml", { "t.yaml": `${LIGHT}font: { family: Acme Sans, file: ./a.txt }\n`, "a.txt": "x" }, "./t.yaml", "font.file"],
  ["font file larger than 500 KB", "./t.yaml", { "t.yaml": `${LIGHT}font: { family: Acme Sans, file: ./a.woff2 }\n`, "a.woff2": Buffer.alloc(501 * KB) }, "./t.yaml", "font.file"],
  ["logo missing", "./t.yaml", { "t.yaml": `${LIGHT}logo: ./logo.svg\n` }, "./t.yaml", "logo"],
  ["logo of the wrong type", "./t.yaml", { "t.yaml": `${LIGHT}logo: ./logo.jpg\n`, "logo.jpg": "x" }, "./t.yaml", "logo"],
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

// Spec 0003 acceptance 6. Oracle, WCAG 2.x by hand: #999999 -> channel 0.6 -> ((0.6 + 0.055) / 1.055)^2.4 = 0.3185 = L;
// white L = 1; (1 + 0.05) / (0.3185 + 0.05) = 2.85.
test("a theme with #999999 text on #ffffff builds and warns with the ratio 2.85:1", () => {
  // The primary pair is given too and passes (#ffffff on #0b5fff is 5.13:1), so the one warning is the text pair's.
  const dir = project("./t.yaml", { "t.yaml": 'light: { base-100: "#ffffff", base-content: "#999999", primary: "#0b5fff", primary-content: "#ffffff" }\n' }, { data: true });
  try {
    const r = build(["dashboard.yaml"], dir);
    assert.equal(r.status, 0, r.stderr);
    const warnings = r.stderr.split("\n").filter(line => line.includes("warning"));
    assert.equal(warnings.length, 1, r.stderr);
    for (const part of ["./t.yaml", "base-content on base-100", "light", "2.85:1"]) assert.ok(warnings[0].includes(part), warnings[0]);
    assert.ok(fs.existsSync(path.join(dir, "dist", "themed.html")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// "Same rendered page" check (spec 0005 acceptance 1): build one fixture config with the code of a base commit and with the
// working tree, then compare the embedded dashboard data and the CSS byte for byte and, after load, the accessibility tree
// under `header` and `main`. The reference always comes from a git worktree of the base commit, never from the new code.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe", encoding: "utf8" });

const trees = {};
function reference(base) {
  if (trees[base]) return trees[base];
  try {
    git("cat-file", "-e", `${base}^{commit}`);
  } catch {
    git("fetch", "--depth=1", "origin", base); // CI clones shallow
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "featherbi-base-"));
  git("worktree", "add", "--detach", path.join(tmp, "tree"), base);
  process.on("exit", () => {
    try {
      git("worktree", "remove", "--force", path.join(tmp, "tree"));
    } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  return (trees[base] = path.join(tmp, "tree"));
}

function build(tree, config, out) {
  // An absolute config (e.g. a per-run volume fixture copy) is used as-is; it must not depend on the tree's fixtures.
  const configPath = path.isAbsolute(config) ? config : path.join(tree, config);
  execFileSync("node", [path.join(tree, "skill/featherbi/scripts/featherbi.mjs"), "build", configPath, "--out", out], { stdio: "pipe" });
  return fs.readFileSync(out, "utf8");
}

// Deliberate differences, named by the plan task that makes them:
//   withoutTiles: titles of tiles cut out of the embedded data text and removed from the page;
//   exclude: page => locators removed from both pages before the accessibility trees are compared;
//   check: page => assertions on the new page, run before anything is removed from it;
//   colours: [before, after] CSS declarations, each put into the reference CSS in place of its old value (it must be there once);
//   dataOnly: the CSS and the accessibility tree differ on purpose, only the embedded data is compared.
export async function samePage(page, base, config, { withoutTiles = [], exclude = () => [], check = async () => {}, colours = [], dataOnly = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "featherbi-same-"));
  try {
    const files = { before: path.join(tmp, "before.html"), after: path.join(tmp, "after.html") };
    const before = build(reference(base), config, files.before);
    const after = build(root, config, files.after);

    // The raw text of the embedded data, minus only the serialized tiles named in `withoutTiles` (each with one separating
    // comma); everything else is compared as written, never re-serialized.
    const data = html => {
      let text = html.match(/<script type="application\/json" id="dashboard">(.*?)<\/script>/s)[1];
      for (const tile of JSON.parse(text).tiles.filter(t => withoutTiles.includes(t.title))) {
        const written = JSON.stringify(tile).replaceAll("<", "\\u003c"); // as render.mjs writes it
        const at = [`,${written}`, `${written},`].find(part => text.split(part).length === 2);
        expect(at, `tile "${tile.title}" is in the data exactly once, as serialized`).toBeTruthy();
        text = text.replace(at, () => "");
      }
      return text;
    };
    const css = html => [...html.matchAll(/<style>(.*?)<\/style>/gs)].map(m => m[1]);
    let expectedCss = css(before);
    for (const [was, now] of colours) {
      expect(expectedCss.join("").split(was).length, `the reference CSS has "${was}" once`).toBe(2);
      expectedCss = expectedCss.map(text => text.replace(was, now));
    }
    expect(data(after) === data(before), "the #dashboard data is byte-identical").toBe(true);
    if (dataOnly) return;
    expect(css(after), "the CSS is byte-identical").toEqual(expectedCss);

    const dropped = [...withoutTiles.map(title => page.getByRole("group", { name: title })), ...exclude(page)];
    const tree = async () => {
      for (const locator of dropped) await locator.evaluateAll(nodes => nodes.forEach(node => node.remove()));
      return `${await page.locator("header").ariaSnapshot()}\n${await page.locator("main").ariaSnapshot()}`;
    };
    // Closed tabs retain busy skeletons; wait for visible cards and settled trees on both pages.
    const settled = async (file, after = false) => {
      await page.goto(pathToFileURL(file).href);
      if (after) await check(page);
      await expect(page.locator("main [role=group]:visible").first()).toBeVisible();
      await expect(page.locator("main [aria-busy=true]:visible")).toHaveCount(0);
      let current = await tree();
      for (let last = null; last !== current; ) {
        last = current;
        await page.waitForTimeout(500);
        current = await tree();
      }
      return current;
    };
    const expected = await settled(files.before);
    const actual = await settled(files.after, true);
    expect(actual).toBe(expected);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

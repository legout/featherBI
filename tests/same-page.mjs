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
  execFileSync("node", [path.join(tree, "skill/featherbi/scripts/featherbi.mjs"), "build", path.join(tree, config), "--out", out], { stdio: "pipe" });
  return fs.readFileSync(out, "utf8");
}

// Deliberate differences, named by the plan task that makes them:
//   withoutTiles: tile titles left out of the data comparison and of the page;
//   exclude: page => locators removed from both pages before the accessibility trees are compared.
export async function samePage(page, base, config, { withoutTiles = [], exclude = () => [] } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "featherbi-same-"));
  try {
    const files = { before: path.join(tmp, "before.html"), after: path.join(tmp, "after.html") };
    const before = build(reference(base), config, files.before);
    const after = build(root, config, files.after);

    const data = html => {
      const text = html.match(/<script type="application\/json" id="dashboard">(.*?)<\/script>/s)[1];
      if (!withoutTiles.length) return text;
      const parsed = JSON.parse(text);
      return JSON.stringify({ ...parsed, tiles: parsed.tiles.filter(t => !withoutTiles.includes(t.title)) });
    };
    const css = html => [...html.matchAll(/<style>(.*?)<\/style>/gs)].map(m => m[1]);
    expect(data(after) === data(before), "the #dashboard data is byte-identical").toBe(true);
    expect(css(after), "the CSS is byte-identical").toEqual(css(before));

    const dropped = [...withoutTiles.map(title => page.getByRole("group", { name: title })), ...exclude(page)];
    const tree = async () => {
      for (const locator of dropped) await locator.evaluateAll(nodes => nodes.forEach(node => node.remove()));
      return `${await page.locator("header").ariaSnapshot()}\n${await page.locator("main").ariaSnapshot()}`;
    };
    // The reference is read once it stops changing (grid rows and chart labels arrive after the tiles stop being busy).
    await page.goto(pathToFileURL(files.before).href);
    await expect(page.locator("main [role=group]").first()).toBeVisible();
    await expect(page.locator("main [aria-busy=true]")).toHaveCount(0);
    let expected = await tree();
    for (let last = null; last !== expected; ) {
      last = expected;
      await page.waitForTimeout(500);
      expected = await tree();
    }
    await page.goto(pathToFileURL(files.after).href);
    await expect.poll(tree).toBe(expected);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

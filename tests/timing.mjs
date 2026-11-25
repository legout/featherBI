// Soft speed target (spec 0001 acceptance 6), measured on the volume fixture; not part of `npm test`.
// Run: node tests/timing.mjs   (needs duckdb on PATH; builds into a temp folder). Prints milliseconds.
// Each timing starts at the action and ends when the Revenue KPI shows a new value AND no tile is aria-busy,
// i.e. every tile has rendered. Filter changes and cross-filter clicks: 6 each, the first is a warm-up and the
// median is taken over the other 5. Targets: initial load < 5000 ms (warm CDN cache), changes < 1000 ms.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = path.join(root, "fixtures/volume");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "timing-"));
const html = path.join(out, "volume.html");

execFileSync("duckdb", ["-no-agent"], { cwd: root, input: fs.readFileSync(path.join(root, "tools/gen-volume.sql")), stdio: ["pipe", "pipe", "pipe"] });
execFileSync(process.execPath, [path.join(root, "skill/featherbi/scripts/featherbi.mjs"), "build", "dashboard.yaml", "--out", html], { cwd: dir, stdio: "pipe" });

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const revenue = () => page.getByRole("group", { name: "Revenue", exact: true }).locator(".stat-value");
  const kpi = async () => (await revenue().textContent())?.trim() ?? "";
  // Resolves once the KPI differs from `before` and no tile is busy.
  const settled = before =>
    page.waitForFunction(
      before => {
        const v = [...document.querySelectorAll('[role="group"]')].find(g => g.getAttribute("aria-labelledby") && g.textContent.startsWith("Revenue") && g.querySelector(".stat-value"))?.querySelector(".stat-value").textContent.trim();
        return v && v !== before && !document.querySelector('[role="group"][aria-busy="true"]');
      },
      before,
      { timeout: 60_000, polling: "raf" },
    );
  const time = async (before, action) => {
    const t0 = performance.now();
    await action();
    await settled(before);
    return performance.now() - t0;
  };
  const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const report = (label, xs) => console.log(`${label}: ${xs.map(Math.round).join(", ")} ms; median of last 5 = ${Math.round(median(xs.slice(1)))} ms`);

  const initial = await time("", () => page.goto(pathToFileURL(html).href));
  console.log(`initial load: ${Math.round(initial)} ms`);

  const region = page.locator("#filters select").first();
  const filter = [];
  for (const value of ["EU", "US", "EU", "US", "EU", "US"]) filter.push(await time(await kpi(), () => region.selectOption(value)));
  report("filter change", filter);

  await time(await kpi(), () => region.selectOption("")); // back to unfiltered; each click then toggles EU on or off
  const eu = page.getByRole("group", { name: "Region × month" }).getByRole("button", { name: "EU", exact: true });
  const cross = [];
  for (let i = 0; i < 6; i++) cross.push(await time(await kpi(), () => eu.click()));
  report("cross-filter click", cross);
} finally {
  await browser.close();
  fs.rmSync(out, { recursive: true, force: true });
}

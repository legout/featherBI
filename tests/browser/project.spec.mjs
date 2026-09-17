import { execFile } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { test } from "@playwright/test";
import { expect, requireInstalledDesktopChrome, rootDir } from "./helpers.mjs";

const execFileAsync = promisify(execFile);
const tracerDir = path.join(rootDir, ".artifacts", "browser", "project-tracer");
const projectDir = path.join(tracerDir, "project");
const sourcePath = path.join(tracerDir, "inspections.json");
const configPath = path.join(projectDir, ".featherbi", "dashboard.config.json");
const zipPath = path.join(projectDir, ".featherbi", "dashboard.zip");
const extractedDir = path.join(projectDir, ".featherbi", "preview");

async function cli(...args) {
 return execFileAsync(process.execPath, [path.join(rootDir, "bin", "featherbi.mjs"), ...args]);
}

test.beforeAll(async ({ browser }) => {
 requireInstalledDesktopChrome(browser);
 await rm(tracerDir, { recursive: true, force: true });
 await mkdir(tracerDir, { recursive: true });
 await cp(path.join(rootDir, "examples", "basic-dashboard"), projectDir, {
  recursive: true,
 });
 await writeFile(
  sourcePath,
  JSON.stringify([
   { station: "SJ", amount: 3 },
   { station: "SJ", amount: 5 },
   { station: "SD", amount: 8 },
   { station: "SD", amount: null },
  ]),
 );
 await cli("compile", "--project", path.join(projectDir, "dashboard.yaml"));
 await cli(
  "build",
  "--config", configPath,
  "--source", `inspections=${sourcePath}`,
  "--output", zipPath,
 );
 await mkdir(extractedDir, { recursive: true });
 await execFileAsync("uv", [
  "run", "python", "-m", "zipfile", "-e", zipPath, extractedDir,
 ]);
});

test("source project compiles and previews from file after explicit selection", async ({ browser }) => {
 const context = await browser.newContext();
 const page = await context.newPage();
 try {
  await page.goto(pathToFileURL(path.join(extractedDir, "dashboard.html")).href, {
   waitUntil: "load",
  });
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "waiting");
  await page.locator("#source-inspections").setInputFiles(
   path.join(extractedDir, "inspections.json"),
  );
  await page.locator("#replace-files").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#component-total [data-value]")).toHaveText("4");
 } finally {
  await context.close();
 }
});

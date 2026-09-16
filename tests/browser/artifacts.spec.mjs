import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { test } from "@playwright/test";
import { expect, requireInstalledDesktopChrome, rootDir } from "./helpers.mjs";

const execFileAsync = promisify(execFile);
const deliveryDir = path.join(rootDir, ".artifacts", "browser", "delivery");
const sourcePath = path.join(deliveryDir, "ap.json");
const zipPath = path.join(deliveryDir, "bundle.zip");
const extractedDir = path.join(deliveryDir, "bundle");
const configPath = path.join(
 rootDir,
 "skill",
 "featherbi",
 "examples",
 "ap.config.json",
);

test.beforeAll(async ({ browser }) => {
 requireInstalledDesktopChrome(browser);
 await rm(deliveryDir, { recursive: true, force: true });
 await mkdir(deliveryDir, { recursive: true });
 await writeFile(
  sourcePath,
  JSON.stringify([
   { station: "SJ" },
   { station: "SJ" },
   { station: "SD" },
   { station: "SD" },
  ]),
 );
 await execFileAsync(process.execPath, [
  path.join(rootDir, "bin", "featherbi.mjs"),
  "build",
  "--config",
  configPath,
  "--source",
  `ap=${sourcePath}`,
  "--output",
  zipPath,
 ]);
 await mkdir(extractedDir, { recursive: true });
 await execFileAsync("uv", [
  "run",
  "python",
  "-m",
  "zipfile",
  "-e",
  zipPath,
  extractedDir,
 ]);
});

test("extracted ZIP reopens after explicit data selection", async ({
 browser,
}) => {
 const context = await browser.newContext();
 const page = await context.newPage();
 try {
  await page.goto(
   pathToFileURL(path.join(extractedDir, "dashboard.html")).href,
   {
    waitUntil: "load",
   },
  );
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "waiting",
  );
  await page
   .locator("#source-ap")
   .setInputFiles(path.join(extractedDir, "ap.json"));
  await page.locator("#replace-files").click();
  await expect(page.locator("#dashboard-status")).toHaveAttribute(
   "data-state",
   "ready",
  );
  await expect(page.locator("#component-records [data-value]")).toHaveText("4");
 } finally {
  await context.close();
 }
});

/**
 * Shared Playwright helpers for the featherBI browser tests.
 *
 * Every test opens the generated harness over `file://` via `pathToFileURL`
 * (never a local web server), in its own isolated context, and these helpers
 * fail the test if the launched browser is not installed desktop Chrome or the
 * page origin is not `file:`.
 */

import { expect } from "@playwright/test";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const rootDir = path.resolve(
 path.dirname(fileURLToPath(import.meta.url)),
 "../..",
);
export const harnessPath = path.join(
 rootDir,
 ".artifacts",
 "browser",
 "harness.html",
);
export const harnessURL = pathToFileURL(harnessPath).href;

/**
 * Detect the installed desktop Google Chrome binary and its version.
 *
 * Playwright's `browserType.executablePath()` does not reflect the launch
 * channel (it returns the default downloaded build), so the honest check is to
 * query the installed desktop binary and compare versions with the browser
 * Playwright actually launched.
 *
 * @returns {{bin: string, version: string}}
 */
function installedDesktopChrome() {
 const candidates =
  process.platform === "darwin"
   ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
   : process.platform === "linux"
     ? [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/opt/google/chrome/chrome",
       ]
     : [];
 for (const bin of candidates) {
  try {
   const output = execFileSync(bin, ["--version"], {
    encoding: "utf8",
    timeout: 15_000,
   });
   const version = output.match(/\d+\.\d+\.\d+\.\d+/);
   if (version) {
    return { bin, version: version[0] };
   }
  } catch {
   // try the next candidate
  }
 }
 throw new Error(
  `installed desktop Google Chrome not found (platform: ${process.platform}); tests require channel:'chrome'`,
 );
}

/**
 * Assert the active Playwright browser is the installed desktop Google Chrome
 * (`channel: 'chrome'`), not a downloaded Chromium/Chrome-for-Testing build.
 *
 * @param {import('@playwright/test').Browser} browser
 * @returns {{executablePath: string, version: string}}
 */
export function requireInstalledDesktopChrome(browser) {
 const { bin, version: installed } = installedDesktopChrome();
 const launched = browser.version();
 if (launched !== installed) {
  throw new Error(
   `Playwright launched browser ${launched} but the installed desktop Chrome is ${installed} (${bin}); expected channel:'chrome'`,
  );
 }
 return { executablePath: bin, version: launched };
}

/**
 * Assert a page URL is a real `file://` origin (no HTTP fallback).
 *
 * @param {string} url
 */
export function assertFileOrigin(url) {
 if (!url.startsWith("file://")) {
  throw new Error(`expected a file:// harness origin, got: ${url}`);
 }
}

/**
 * Open the generated harness page in a fresh isolated context.
 *
 * @param {import('@playwright/test').Browser} browser
 * @returns {Promise<{page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext}>}
 */
export async function openHarness(browser) {
 const context = await browser.newContext();
 const page = await context.newPage();
 await page.goto(harnessURL, { waitUntil: "load" });
 assertFileOrigin(page.url());
 await page.waitForFunction(
  () =>
   Boolean(window.__featherbiHarness) &&
   Boolean(window.__featherbiHarness.meta),
  undefined,
  { timeout: 15_000 },
 );
 return { page, context };
}

/**
 * Close a harness context (bounded, error-tolerant cleanup).
 *
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function closeHarness(context) {
 await context.close();
}

export { expect };

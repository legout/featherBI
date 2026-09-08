/**
 * Playwright configuration for the featherBI browser tests.
 *
 * Chrome-only: the `chrome` project launches the installed desktop Google
 * Chrome via `channel: 'chrome'`. One worker, no retries, isolated per-test
 * contexts, bounded timeouts, and failure screenshots under `.artifacts/`.
 * Tests run against the generated `file://` harness page; a local HTTP server
 * is never used.
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
 testDir: "tests/browser",
 outputDir: ".artifacts/browser/test-results",
 fullyParallel: false,
 workers: 1,
 retries: 0,
 timeout: 90_000,
 expect: { timeout: 10_000 },
 reporter: [["list"]],
 use: {
  channel: "chrome",
  headless: true,
  screenshot: "only-on-failure",
  trace: "off",
  video: "off",
 },
 projects: [
  {
   name: "chrome",
   use: { channel: "chrome" },
  },
 ],
});

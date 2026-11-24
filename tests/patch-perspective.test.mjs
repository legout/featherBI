import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(new URL("../tools/patch-perspective.mjs", import.meta.url));

test("Perspective patch applies both anchors and fails without writing output when either is missing", async () => {
  const { ANCHORS } = await import(pathToFileURL(script).href);
  assert.equal(ANCHORS.length, 2);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perspective-patch-"));
  try {
    const input = path.join(dir, "input.js");
    const output = path.join(dir, "output.js");
    const run = () => spawnSync(process.execPath, [script, "--input", input, "--output", output], { encoding: "utf8" });
    fs.writeFileSync(input, ANCHORS.map(a => a.find).join("\n"));
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    const patched = fs.readFileSync(output, "utf8");
    for (const anchor of ANCHORS) {
      assert.ok(patched.includes(anchor.replace), anchor.name);
      assert.ok(!patched.includes(anchor.find), anchor.name);
    }
    for (const missing of ANCHORS) {
      fs.rmSync(output, { force: true });
      fs.writeFileSync(input, ANCHORS.filter(a => a !== missing).map(a => a.find).join("\n"));
      result = run();
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.stderr.includes(missing.name), result.stderr);
      assert.equal(fs.existsSync(output), false);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

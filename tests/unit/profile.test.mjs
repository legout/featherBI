import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function profile(format, extra = []) {
 const extension = format === "ndjson" ? "ndjson" : format;
 const input = path.join(rootDir, ".artifacts", "fixtures", `inspections.${extension}`);
 const { stdout } = await execFileAsync(process.execPath, [
  path.join(rootDir, "bin", "featherbi.mjs"),
  "profile",
  "--input", input,
  "--source-id", `small_${format}`,
  "--format", format,
  ...extra,
 ], { maxBuffer: 100_000 });
 return { input, stdout, value: JSON.parse(stdout) };
}

test("bounded profiler supports small CSV, JSON, NDJSON, and Parquet without values or paths", async () => {
 for (const format of ["csv", "json", "ndjson", "parquet"]) {
  const { input, stdout, value } = await profile(format);
  assert.equal(value.source_id, `small_${format}`);
  assert.equal(value.format, format);
  assert.equal(value.row_count, 5);
  assert.equal(value.columns.length, 8);
  assert.equal(value.values_included, false);
  assert.equal(value.columns.every((column) => column.distinct_count_kind === "approximate"), true);
  assert.equal(stdout.includes(input), false);
  assert.equal(stdout.length < 15_000, true);
  assert.equal(JSON.stringify(value).includes("top_counts"), false);
  assert.equal(JSON.stringify(value).includes('"range"'), false);
  assert.equal(JSON.stringify(value).includes('"value"'), false);
 }
});

test("value output requires the explicit opt-in flag and stays bounded", async () => {
 const { value } = await profile("csv", ["--include-values"]);
 assert.equal(value.values_included, true);
 assert.ok(value.columns.some((column) => column.top_counts?.length > 0));
 assert.equal(
  value.columns.every((column) => !column.top_counts || column.top_counts.length <= 5),
  true,
 );
});

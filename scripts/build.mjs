import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { validateConfig } from "../contract/config.mjs";
import { DUCKDB_WASM_VERSION } from "../runtime/bootstrap.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

/** Render the fixed viewer with a safely embedded config and optional test inputs. */
export async function renderDashboard({ config, inputs = null }) {
 const validation = validateConfig(config);
 if (!validation.ok) {
  throw new Error(
   `invalid dashboard config: ${validation.issues
    .map((issue) => `${issue.path || "config"}: ${issue.message}`)
    .join("; ")}`,
  );
 }
 const echarts = parseJson(
  await readFile(path.join(rootDir, "node_modules/echarts/package.json"), "utf8"),
  "ECharts package metadata",
 ).version;
 const theme = await themeAdapter(config.theme ?? "neutral");
 const build = await esbuild.build({
  stdin: {
   contents: `
    import { mountDashboard } from "./runtime/viewer.mjs";
    const config = ${scriptJson(config)};
    const embeddedInputs = ${scriptJson(inputs)};
    const inputs = embeddedInputs?.map(({ id, value }) => ({
     source: config.data.sources.find((source) => source.id === id),
     bytes: { encoding: "base64", value },
    }));
    window.__featherbiBuild = ${scriptJson({ duckdbWasm: DUCKDB_WASM_VERSION, echarts, theme: config.theme ?? "neutral", themeVersion: theme.version })};
    window.__featherbiDashboardReady = mountDashboard({ config, inputs });
    window.__featherbiDashboardReady.catch(() => {});
   `,
   resolveDir: rootDir,
   sourcefile: "featherbi-dashboard-entry.mjs",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome130",
  minify: false,
  write: false,
  legalComments: "none",
  logLevel: "warning",
 });
 const code = build.outputFiles[0].text;
 const safeCode = code.replaceAll("</script", "<\\/script");
 const shell = await readFile(path.join(rootDir, "shells/grid.html"), "utf8");
 const css = `${await readFile(path.join(rootDir, "runtime/viewer.css"), "utf8")}\n${theme.css}\n${config.themeCss ?? ""}`.replaceAll("</style", "<\\/style");
 const html = shell
  .replace("<!-- FEATHERBI_STYLE -->", css)
  .replace("<!-- FEATHERBI_SCRIPT -->", `<script>\n${safeCode}\n</script>`);
 return {
  html,
  bundleSha256: createHash("sha256").update(safeCode).digest("hex"),
  duckdbWasm: DUCKDB_WASM_VERSION,
  echarts,
 };
}

async function themeAdapter(theme) {
 if (theme === "daisyui") {
  const metadata = parseJson(await readFile(path.join(rootDir, "node_modules/daisyui/package.json"), "utf8"), "daisyUI package metadata");
  return { version: metadata.version, css: `/* featherbi-theme:daisyui@${metadata.version} */\n${await daisyCss()}` };
 }
 if (theme === "siemens-ix") {
  const metadata = parseJson(await readFile(path.join(rootDir, "node_modules/@siemens/ix/package.json"), "utf8"), "Siemens iX package metadata");
  return { version: metadata.version, css: `/* featherbi-theme:siemens-ix@${metadata.version} */\n${await readFile(path.join(rootDir, "node_modules/@siemens/ix/dist/siemens-ix/siemens-ix-core.css"), "utf8")}` };
 }
 return { version: "built-in", css: "/* featherbi-theme:neutral@built-in */" };
}

async function daisyCss() {
 await mkdir(path.join(rootDir, ".artifacts"), { recursive: true });
 const temporary = await mkdtemp(path.join(rootDir, ".artifacts", "daisy-"));
 const input = path.join(temporary, "theme.css");
 const output = path.join(temporary, "theme.generated.css");
 await writeFile(input, '@import "tailwindcss" source(none);\n@plugin "daisyui" { themes: light --default; }\n@source inline("btn card table input select checkbox");\n');
 try {
  await execFileAsync(path.join(rootDir, "node_modules", ".bin", "tailwindcss"), ["-i", input, "-o", output, "--minify"], { cwd: rootDir });
  return await readFile(output, "utf8");
 } finally {
  await rm(temporary, { recursive: true, force: true });
 }
}

/** Build the fixed viewer to a path. Packager publication wraps this renderer atomically. */
export async function buildDashboard({ config, outPath, inputs = null }) {
 const { html, ...metadata } = await renderDashboard({ config, inputs });
 await mkdir(path.dirname(outPath), { recursive: true });
 await writeFile(outPath, html, "utf8");
 return { outPath, ...metadata };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
 const configPath = path.resolve(process.argv[2] ?? "examples/ap-dashboard.config.json");
 const outPath = path.resolve(process.argv[3] ?? "build/ap-dashboard.html");
 const config = parseJson(await readFile(configPath, "utf8"), configPath);
 const metadata = await buildDashboard({ config, outPath });
 console.log(`wrote ${metadata.outPath}`);
 console.log(
  `bundle sha256=${metadata.bundleSha256} duckdb-wasm=${metadata.duckdbWasm} echarts=${metadata.echarts}`,
 );
}

function parseJson(text, label) {
 try {
  return JSON.parse(text);
 } catch (error) {
  throw new Error(`invalid JSON in ${label}: ${error.message}`, { cause: error });
 }
}

function scriptJson(value) {
 return JSON.stringify(value).replaceAll("<", "\\u003c");
}

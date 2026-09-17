import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { validateConfig } from "../contract/config.mjs";
import { DUCKDB_WASM_VERSION } from "../runtime/bootstrap.mjs";

const rootDir = path.resolve(
 path.dirname(fileURLToPath(import.meta.url)),
 "..",
);
const execFileAsync = promisify(execFile);
const CHART_TYPES = new Set([
 "bar",
 "line",
 "area",
 "scatter",
 "pie",
 "donut",
 "heatmap",
 "treemap",
 "sankey",
 "gauge",
 "boxplot",
]);
const CAPABILITY_VERSIONS = {
 core: "0.1.0",
 "ag-grid": "35.3.1",
 echarts: "6.1.0",
 perspective: "3.8.0",
 codemirror: "6.10.0",
 daisyui: "5.2.1",
 "siemens-ix": "5.2.1",
};

/** Resolve project-selected runtime modules in deterministic dependency order. */
export function resolveCapabilities(config) {
 const ids = new Set(["core"]);
 const chart = config.layout.some(({ type }) => CHART_TYPES.has(type));
 if (
  config.layout.some(({ type }) => type === "table") ||
  config.playground?.renderer === "ag-grid"
 )
  ids.add("ag-grid");
 if (chart && config.rendererPreset !== "perspective-first") ids.add("echarts");
 if (
  config.layout.some(({ type }) => type === "perspective") ||
  config.rendererPreset === "perspective-first" ||
  config.playground?.renderer === "perspective"
 )
  ids.add("perspective");
 if (config.playground) ids.add("codemirror");
 if (config.theme === "daisyui") ids.add("daisyui");
 if (config.theme === "siemens-ix") ids.add("siemens-ix");
 return [
  "core",
  "ag-grid",
  "echarts",
  "perspective",
  "codemirror",
  "daisyui",
  "siemens-ix",
 ]
  .filter((id) => ids.has(id))
  .map((id) => ({ id, version: CAPABILITY_VERSIONS[id] }));
}

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
 const capabilities = await capabilityManifest(resolveCapabilities(config));
 const selected = new Set(capabilities.map(({ id }) => id));
 const imports = ['import { mountDashboard } from "./runtime/viewer.mjs";'];
 const runtimeCapabilities = [];
 if (selected.has("ag-grid")) {
  imports.push(
   'import { gridCapability } from "./runtime/capabilities/grid.mjs";',
  );
  runtimeCapabilities.push("grid: gridCapability");
 }
 if (selected.has("echarts")) {
  imports.push(
   'import { chartCapability } from "./runtime/capabilities/charts.mjs";',
  );
  runtimeCapabilities.push("charts: chartCapability");
 }
 if (selected.has("perspective")) {
  imports.push(
   'import { perspectiveCapability } from "./runtime/capabilities/perspective.mjs";',
  );
  runtimeCapabilities.push("perspective: perspectiveCapability");
 }
 if (selected.has("codemirror")) {
  imports.push(
   'import { editorCapability } from "./runtime/capabilities/editor.mjs";',
  );
  runtimeCapabilities.push("editor: editorCapability");
 }
 const theme = await themeAdapter(config.theme ?? "neutral");
 const buildMetadata = {
  duckdbWasm: DUCKDB_WASM_VERSION,
  theme: config.theme ?? "neutral",
  themeVersion: theme.version,
  capabilities,
 };
 const build = await esbuild.build({
  stdin: {
   contents: `
    ${imports.join("\n")}
    const config = ${scriptJson(config)};
    const embeddedInputs = ${scriptJson(inputs)};
    const inputs = embeddedInputs?.map(({ id, value }) => ({
     source: config.data.sources.find((source) => source.id === id),
     bytes: { encoding: "base64", value },
    }));
    const capabilities = { ${runtimeCapabilities.join(", ")} };
    window.__featherbiBuild = ${scriptJson(buildMetadata)};
    window.__featherbiDashboardReady = mountDashboard({ config, inputs, capabilities });
    window.__featherbiDashboardReady.catch(() => {});
   `,
   resolveDir: rootDir,
   sourcefile: "featherbi-dashboard-entry.mjs",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome130",
  outfile: "viewer.js",
  loader: { ".wasm": "binary" },
  metafile: true,
  minify: false,
  write: false,
  legalComments: "none",
  logLevel: "warning",
 });
 const code = build.outputFiles.find(({ path: outputPath }) =>
  outputPath.endsWith(".js"),
 ).text;
 const safeCode = code.replaceAll("</script", "<\\/script");
 const shell = await readFile(path.join(rootDir, "shells/grid.html"), "utf8");
 const perspectiveCss = selected.has("perspective")
  ? await readFile(
     path.join(
      rootDir,
      "node_modules/@finos/perspective-viewer/dist/css/pro.css",
     ),
     "utf8",
    )
  : "";
 const css =
  `${await readFile(path.join(rootDir, "runtime/viewer.css"), "utf8")}\n${theme.css}\n${perspectiveCss}\n${config.themeCss ?? ""}`.replaceAll(
   "</style",
   "<\\/style",
  );
 const html = shell
  .replace("<!-- FEATHERBI_STYLE -->", () => css)
  .replace(
   "<!-- FEATHERBI_SCRIPT -->",
   () => `<script>\n${safeCode}\n</script>`,
  );
 return {
  html,
  bundleSha256: createHash("sha256").update(safeCode).digest("hex"),
  duckdbWasm: DUCKDB_WASM_VERSION,
  echarts: selected.has("echarts") ? CAPABILITY_VERSIONS.echarts : null,
  capabilities,
  metafile: build.metafile,
 };
}

async function capabilityManifest(capabilities) {
 return Promise.all(
  capabilities.map(async (capability) => {
   if (capability.id !== "perspective") return capability;
   const assets = await Promise.all(
    [
     [
      "perspective-js.wasm",
      "@finos/perspective/dist/wasm/perspective-js.wasm",
     ],
     [
      "perspective-server.wasm",
      "@finos/perspective/dist/wasm/perspective-server.wasm",
     ],
     [
      "perspective-viewer.wasm",
      "@finos/perspective-viewer/dist/wasm/perspective-viewer.wasm",
     ],
    ].map(async ([name, relative]) => {
     const bytes = await readFile(path.join(rootDir, "node_modules", relative));
     return {
      name,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
     };
    }),
   );
   return { ...capability, assets };
  }),
 );
}

async function themeAdapter(theme) {
 if (theme === "daisyui") {
  const metadata = parseJson(
   await readFile(
    path.join(rootDir, "node_modules/daisyui/package.json"),
    "utf8",
   ),
   "daisyUI package metadata",
  );
  return {
   version: metadata.version,
   css: `/* featherbi-theme:daisyui@${metadata.version} */\n${await daisyCss()}`,
  };
 }
 if (theme === "siemens-ix") {
  const metadata = parseJson(
   await readFile(
    path.join(rootDir, "node_modules/@siemens/ix/package.json"),
    "utf8",
   ),
   "Siemens iX package metadata",
  );
  return {
   version: metadata.version,
   css: `/* featherbi-theme:siemens-ix@${metadata.version} */\n${await readFile(path.join(rootDir, "node_modules/@siemens/ix/dist/siemens-ix/siemens-ix-core.css"), "utf8")}`,
  };
 }
 return { version: "built-in", css: "/* featherbi-theme:neutral@built-in */" };
}

async function daisyCss() {
 await mkdir(path.join(rootDir, ".artifacts"), { recursive: true });
 const temporary = await mkdtemp(path.join(rootDir, ".artifacts", "daisy-"));
 const input = path.join(temporary, "theme.css");
 const output = path.join(temporary, "theme.generated.css");
 await writeFile(
  input,
  '@import "tailwindcss" source(none);\n@plugin "daisyui" { themes: light --default; }\n@source inline("btn card table input select checkbox");\n',
 );
 try {
  await execFileAsync(
   path.join(rootDir, "node_modules", ".bin", "tailwindcss"),
   ["-i", input, "-o", output, "--minify"],
   { cwd: rootDir },
  );
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
 const configPath = process.argv[2];
 const outPath = process.argv[3];
 if (!configPath || !outPath) {
  // Default build: compile the AP example project and render it as a smoke check.
  const { compileProject } = await import("../authoring/compiler.mjs");
  const { config } = await compileProject(
   path.join(rootDir, "examples", "ap-dashboard", "dashboard.yaml"),
  );
  const metadata = await buildDashboard({
   config,
   outPath: path.join(rootDir, "build", "ap-dashboard.html"),
  });
  console.log(`wrote ${metadata.outPath}`);
  console.log(
   `bundle sha256=${metadata.bundleSha256} duckdb-wasm=${metadata.duckdbWasm} echarts=${metadata.echarts}`,
  );
 } else {
  const config = parseJson(
   await readFile(path.resolve(configPath), "utf8"),
   configPath,
  );
  const metadata = await buildDashboard({
   config,
   outPath: path.resolve(outPath),
  });
  console.log(`wrote ${metadata.outPath}`);
  console.log(
   `bundle sha256=${metadata.bundleSha256} duckdb-wasm=${metadata.duckdbWasm} echarts=${metadata.echarts}`,
  );
 }
}

function parseJson(text, label) {
 try {
  return JSON.parse(text);
 } catch (error) {
  throw new Error(`invalid JSON in ${label}: ${error.message}`, {
   cause: error,
  });
 }
}

function scriptJson(value) {
 return JSON.stringify(value).replaceAll("<", "\\u003c");
}

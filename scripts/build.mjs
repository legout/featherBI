import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { validateConfig } from "../contract/config.mjs";
import {
 DUCKDB_DUCKLAKE_CAPABILITY,
 DUCKDB_ICEBERG_CAPABILITY,
 DUCKDB_WASM_BUNDLES,
 DUCKDB_WASM_VERSION,
} from "../runtime/bootstrap.mjs";

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
 iceberg: DUCKDB_WASM_VERSION,
 ducklake: DUCKDB_WASM_VERSION,
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
 // The trusted Iceberg capability is selected only when the compiled
 // dashboard declares an Iceberg source (spec §3); the runtime loads it by
 // name from the pinned build's default trusted repository, and no project
 // declaration can name an extension location.
 if (config.data.sources.some(({ remote }) => remote?.kind === "iceberg"))
  ids.add("iceberg");
 // The trusted DuckLake capability is selected only when the compiled
 // dashboard declares a DuckLake source (spec 2026-10-19-0005 §5); the
 // runtime loads it by name from the pinned build's default trusted
 // repository, and no project declaration can name an extension location.
 if (config.data.sources.some(({ remote }) => remote?.kind === "ducklake"))
  ids.add("ducklake");
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
  "iceberg",
  "ducklake",
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

/**
 * Content-Security-Policy embedded by the static target (spec
 * 2026-10-19-0005 §7): exact origins only, in the shape the S1 probe
 * verified against the pinned DuckDB-WASM runtime
 * (project/research/static-hosting-cors-csp-probe.md). Inline script and
 * style, `wasm-unsafe-eval`, and the blob worker are required for the
 * bundled runtime to boot; `connect-src` carries the declared live source
 * origins plus the pinned asset and extension-repository origins, because
 * `LOAD httpfs` fetches dynamically in this build.
 * @throws when a live source's actual request origin is not derivable at
 * build time (owner decisions 2026-10-19, ticket #43)
 */
export function staticContentSecurityPolicy(config) {
 const assets = new URL(DUCKDB_WASM_BUNDLES.eh.mainModule).origin;
 const extensions = new URL(DUCKDB_ICEBERG_CAPABILITY.url).origin;
 const live = liveSourceOrigins(config);
 const connect = ["'self'", assets, extensions, ...live].join(" ");
 return [
  "default-src 'none'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${assets}`,
  "worker-src 'self' blob:",
  `connect-src ${connect}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
 ].join("; ");
}

/**
 * Exact browser request origins of one compiled config's live sources:
 * declared HTTP(S) URL origins, the configured S3 endpoint (the runtime
 * reads it path-style), or the AWS endpoints of a declared bucket+region
 * (the regional virtual-host origin plus the us-east-1 global hop). Source
 * shapes whose actual origin resolves only at runtime are rejected here
 * (owner decisions 2026-10-19, ticket #43); the zip target accepts them.
 */
function liveSourceOrigins(config) {
 const origins = new Set();
 for (const source of config.data.sources) {
  const remote = source.remote;
  if (!remote) continue;
  const id = JSON.stringify(source.id);
  if (remote.catalog) {
   // A REST catalog supplies the s3:// storage bucket at open time
   // (runtime/sources.mjs resolveCatalogMetadataLocation), so only an
   // explicit endpoint yields a build-time origin; catalog.endpoint and
   // region never substitute.
   if (!remote.endpoint) {
    throw new Error(
     `static target cannot derive an exact origin for catalog iceberg source ${id}: the catalog resolves the bucket at open time, so declare endpoint, or use the zip target`,
    );
   }
   origins.add(urlOrigin(remote.catalog.endpoint, id));
   origins.add(s3EndpointOrigin(id, remote.endpoint));
  }
  for (const location of [
   remote.uri,
   remote.selector?.manifest,
   remote.metadataUri,
  ]) {
   if (typeof location !== "string") continue;
   if (/^s3:\/\//i.test(location)) {
    for (const origin of s3Origins(id, location, remote)) origins.add(origin);
   } else {
    origins.add(urlOrigin(location, id));
   }
  }
 }
 return [...origins].sort();
}

/** Exact origin of an S3 endpoint; author config may omit its HTTPS scheme. */
function s3EndpointOrigin(id, endpoint) {
 const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)
  ? endpoint
  : `https://${endpoint}`;
 return urlOrigin(url, id);
}

/** Exact origins of one s3:// location under its source's S3 settings. */
function s3Origins(id, location, remote) {
 const bucket = location.slice("s3://".length).split("/")[0];
 if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(bucket)) {
  throw new Error(
   `static target cannot derive an exact origin for s3 source ${id}: bucket ${JSON.stringify(bucket)} is not a derivable endpoint host, or use the zip target`,
  );
 }
 if (remote.endpoint) return [s3EndpointOrigin(id, remote.endpoint)];
 if (!remote.region) {
  throw new Error(
   `static target cannot derive an exact origin for s3 source ${id}: declare region or endpoint for its bucket, or use the zip target`,
  );
 }
 if (!/^[a-z0-9-]+$/i.test(remote.region)) {
  throw new Error(
   `static target cannot derive an exact origin for s3 source ${id}: region ${JSON.stringify(remote.region)} is not a derivable region, or use the zip target`,
  );
 }
 return [
  `https://${bucket}.s3.${remote.region}.amazonaws.com`,
  `https://${bucket}.s3.amazonaws.com`,
 ];
}

/** Exact origin of one declared HTTP(S) URL, rejecting anything else. */
function urlOrigin(value, id) {
 let url;
 try {
  url = new URL(value);
 } catch {
  url = null;
 }
 if (!url || !/^https?:$/.test(url.protocol)) {
  throw new Error(
   `static target cannot derive an exact origin for source ${id}: ${JSON.stringify(value)} is not an http(s) URL, or use the zip target`,
  );
 }
 return url.origin;
}

/** Render the fixed viewer with a safely embedded config and optional test inputs. */
export async function renderDashboard({ config, inputs = null, csp = null }) {
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
 // A baked token theme (object) carries its own css/echarts and uses no
 // shell adapter; legacy string themes keep their adapter CSS. A baked
 // preset must never resolve the legacy adapter of the same name.
 const bakedTheme = typeof config.theme === "object" && config.theme !== null;
 const themeName = bakedTheme ? config.theme.name : (config.theme ?? "neutral");
 const theme = bakedTheme
  ? { version: "tokens-v1", css: `/* featherbi-theme:${themeName}@tokens-v1 */` }
  : await themeAdapter(themeName);
 const buildMetadata = {
  duckdbWasm: DUCKDB_WASM_VERSION,
  theme: themeName,
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
  // The optional static-target CSP meta must precede the style and script
  // it governs; its value is built from URL origins and validated
  // identifiers only, so it cannot contain attribute-breaking characters.
  .replace(
   "<!-- FEATHERBI_CSP -->",
   () =>
    csp === null
     ? ""
     : `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
  )
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
   if (capability.id === "iceberg") {
    // Record the exact pinned trusted artifact (ADR 0009); the runtime
    // loads the extension by name from the build's default trusted
    // repository, never from a project-authored location.
    return { ...capability, ...DUCKDB_ICEBERG_CAPABILITY };
   }
   if (capability.id === "ducklake") {
    // Record the exact owner-approved pinned artifact and its SHA-256
    // (ADR 0009, plan 0005 G3); the runtime loads the extension by name
    // from the build's default trusted repository, never from a
    // project-authored location.
    return { ...capability, ...DUCKDB_DUCKLAKE_CAPABILITY };
   }
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
 return { version: "built-in", css: `/* featherbi-theme:${theme}@built-in */` };
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

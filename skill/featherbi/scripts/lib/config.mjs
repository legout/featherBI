// Loads dashboard.yaml and checks the few things the build relies on.
import fs from "node:fs";
import { CREDENTIAL_KEY } from "./sources.mjs";
import { parse } from "./vendor/yaml/index.js";

const ENGINES = ["haybarn", "duckdb-wasm"];
const kebab = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function loadConfig(file) {
  const c = parse(fs.readFileSync(file, "utf8"));
  const need = (ok, message) => {
    if (!ok) throw new Error(`${file}: ${message}`);
  };
  need(c && typeof c === "object" && !Array.isArray(c), "the config must be a YAML mapping");
  need(typeof c.title === "string" && c.title.trim(), "`title` is required");
  const name = kebab(String(c.name ?? c.title));
  need(name, "`name` needs at least one letter or digit");
  const engine = c.engine ?? "haybarn";
  need(ENGINES.includes(engine), `\`engine\` must be one of: ${ENGINES.join(", ")}`);

  const sources = Object.entries(c.sources ?? {});
  need(sources.length, "`sources` needs at least one source");
  for (const [source, spec] of sources) {
    // Source names become table names in the browser, so they must be plain identifiers.
    need(/^[A-Za-z_][A-Za-z0-9_]*$/.test(source), `source "${source}": the name must be a plain identifier`);
    for (const key of Object.keys(spec ?? {})) {
      need(!CREDENTIAL_KEY.test(key), `source "${source}": \`${key}\` looks like a credential; use the environment or DuckDB secrets`);
    }
    const attach = typeof spec?.attach === "string";
    need(typeof spec?.read === "string" !== attach, `source "${source}": give either \`read\` (a DuckDB table expression) or \`attach\``);
    need(!attach || typeof spec.table === "string" !== (typeof spec.sql === "string"), `source "${source}": \`attach\` needs \`table\` or \`sql\``);
  }

  need(Array.isArray(c.tiles) && c.tiles.length, "`tiles` needs at least one tile");
  return { title: c.title, name, engine, sources: c.sources, dims: c.dims, date: c.date, explore: c.explore, tiles: c.tiles };
}

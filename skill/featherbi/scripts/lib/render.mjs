// Render phase: template + prebuilt CSS + renderer + config + snapshot -> one HTML string.
import fs from "node:fs";

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const escapeHtml = s => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
// JSON inside <script>: no "<", so no value (tile SQL, titles) can close the element.
const json = value => JSON.stringify(value).replaceAll("<", "\\u003c");

export function render(config, snapshots) {
  const lock = JSON.parse(read("assets/vendor.lock.json"));
  const engine = lock.engines[config.engine];
  const parts = {
    title: escapeHtml(config.title),
    css: read("assets/app.css"),
    importmap: json({
      imports: { "apache-arrow": lock["apache-arrow"].url },
      integrity: { [engine.module.url]: engine.module.integrity },
    }),
    // Only tile SQL and snapshot data reach the page; source SQL stays on the author's machine.
    data: json({
      engine,
      tiles: config.tiles,
      snapshots: Object.fromEntries(Object.entries(snapshots).map(([name, bytes]) => [name, bytes.toString("base64")])),
    }),
    renderer: read("assets/renderer.js"),
  };
  // One pass over the template, so "{{…}}" inside inserted content is never substituted.
  return read("templates/dashboard.html").replace(/\{\{(\w+)\}\}/g, (_, key) => parts[key]);
}

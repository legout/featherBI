// Release tooling: builds the DaisyUI + Tailwind CSS that ships prebuilt with the skill.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const path = file => fileURLToPath(new URL(`../${file}`, import.meta.url));
// Tailwind scans its working directory for class names: the templates, plus the renderer named in tools/app.css.
execFileSync("npx", ["@tailwindcss/cli", "-i", path("tools/app.css"), "-o", path("skill/featherbi/assets/app.css"), "--minify"], {
  cwd: path("skill/featherbi/templates"),
  stdio: "inherit",
});

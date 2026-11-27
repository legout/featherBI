// Themes (spec 0003): a built-in theme or the author's theme file becomes one <style> block that overrides the DaisyUI
// tokens of the prebuilt CSS, plus an embedded font and logo. Everything is checked before any source is read.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./vendor/yaml/index.js";

const BUILT_IN = fileURLToPath(new URL("../../themes/", import.meta.url));
const NAMES = ["primary", "secondary", "accent", "neutral", "info", "success", "warning", "error"];
const TOKENS = ["base-100", "base-200", "base-300", "base-content", ...NAMES.flatMap(name => [name, `${name}-content`])];
const KEYS = ["name", "light", "dark", "palette", "radius", "font", "logo"];
// The schemes ride on the two themes of the prebuilt CSS (winter, night), so a token the file leaves out keeps its default.
const SELECTOR = { light: ":root,[data-theme=winter]", dark: ":root:has(input.theme-controller[value=night]:checked),[data-theme=night]" };
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// oklch() as CSS writes it: three numbers (or `none`), each with an optional % or angle unit, and an optional alpha.
const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?`;
const OKLCH = new RegExp(String.raw`^oklch\(\s*(${NUMBER}%?|none)\s+(${NUMBER}%?|none)\s+(${NUMBER}(?:deg|grad|rad|turn)?|none)\s*(?:/\s*(${NUMBER}%?|none)\s*)?\)$`, "i");
const TURN = { deg: 360, grad: 400, rad: 2 * Math.PI, turn: 1 };
// A file is what its bytes say, not what its name says: [type, the test its first bytes must pass].
const starts = (...magic) => bytes => magic.some(m => bytes.subarray(0, m.length).equals(Buffer.from(m, "latin1")));
// An SVG file's root element is <svg>, after an optional byte order mark, XML declaration, comments and doctype.
const svg = bytes => /^\uFEFF?\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(bytes.toString("utf8"));
const FONT_TYPES = { ".woff2": ["font/woff2", starts("wOF2")], ".woff": ["font/woff", starts("wOFF")], ".ttf": ["font/ttf", starts("\x00\x01\x00\x00", "true")], ".otf": ["font/otf", starts("OTTO")] };
const LOGO_TYPES = { ".svg": ["image/svg+xml", svg], ".png": ["image/png", starts("\x89PNG\r\n\x1a\n")] };
const KB = 1024;
const CONTRAST_PAIRS = [["base-content", "base-100"], ["primary-content", "primary"]];

// A hex or oklch() colour -> { rgb: sRGB channels 0..1 as the browser paints them, alpha }, or null when it is neither.
function parseColour(colour) {
  if (typeof colour !== "string") return null;
  if (HEX.test(colour)) {
    const hex = colour.length < 6 ? [...colour.slice(1)].map(c => c + c).join("") : colour.slice(1);
    const channel = i => parseInt(hex.slice(i, i + 2), 16) / 255;
    return { rgb: [0, 2, 4].map(channel), alpha: hex.length === 8 ? channel(6) : 1 };
  }
  const m = OKLCH.exec(colour.trim());
  if (!m) return null;
  // `none` counts as 0, except for alpha; a percentage is of `whole`.
  const amount = (text, whole) => (text === undefined ? 1 : /none/i.test(text) ? 0 : text.endsWith("%") ? (parseFloat(text) / 100) * whole : parseFloat(text));
  const clamp = v => Math.min(1, Math.max(0, v));
  const [L, C] = [clamp(amount(m[1], 1)), Math.max(0, amount(m[2], 0.4))];
  // A missing hue (`none`) is 0.
  const h = /none/i.test(m[3]) ? 0 : (parseFloat(m[3]) / TURN[/[a-z]+$/i.exec(m[3])?.[0].toLowerCase() ?? "deg"]) * 2 * Math.PI;
  // OKLCH -> OKLab -> linear sRGB (Björn Ottosson's matrices), clipped to the sRGB gamut, then gamma-encoded.
  const [a, b] = [C * Math.cos(h), C * Math.sin(h)];
  const [x, y, z] = [(L + 0.3963377774 * a + 0.2158037573 * b) ** 3, (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, (L - 0.0894841775 * a - 1.291485548 * b) ** 3];
  const linear = [4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z, -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z, -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z];
  return { rgb: linear.map(clamp).map(v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)), alpha: clamp(amount(m[4], 1)) };
}
// `top` painted over the opaque `under`, as the browser composites it (in sRGB) -> opaque sRGB channels.
const over = (top, under) => top.rgb.map((c, i) => c * top.alpha + under[i] * (1 - top.alpha));
// WCAG 2.x relative luminance of opaque sRGB channels, and the contrast ratio of two of them.
const luminance = rgb => rgb.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

const isMap = v => v !== null && typeof v === "object" && !Array.isArray(v);

// The checked content of one theme file. `file` is how the config names it, for the error messages.
function read(file, location) {
  const fail = (key, problem) => {
    throw new Error(`theme ${file}: ${key}: ${problem}`);
  };
  let t;
  try {
    t = parse(fs.readFileSync(location, "utf8"));
  } catch (e) {
    fail("theme", e.code === "ENOENT" ? (location.startsWith(BUILT_IN) ? `unknown built-in theme; the built-in themes are: ${fs.readdirSync(BUILT_IN).map(f => path.basename(f, ".yaml")).join(", ")}` : `file not found (${location})`) : `not valid YAML: ${e.message}`);
  }
  if (!isMap(t)) fail("theme", "the theme file must be a YAML mapping");
  for (const key of Object.keys(t)) if (!KEYS.includes(key)) fail(key, `unknown key; the keys are: ${KEYS.join(", ")}`);
  const colour = (value, key) => {
    if (!parseColour(value)) fail(key, 'must be a hex or oklch() colour in quotes, like "#0b5fff" or "oklch(57% 0.25 258)"');
  };
  const schemes = ["light", "dark"].filter(scheme => t[scheme] !== undefined);
  if (!schemes.length) fail("light", "give at least one of `light` and `dark`");
  for (const scheme of schemes) {
    if (!isMap(t[scheme])) fail(scheme, "must be a mapping of colour tokens");
    for (const [token, value] of Object.entries(t[scheme])) {
      if (!TOKENS.includes(token)) fail(`${scheme}.${token}`, `unknown colour token; the tokens are: ${TOKENS.join(", ")}`);
      colour(value, `${scheme}.${token}`);
    }
  }
  if (t.palette !== undefined) {
    if (!Array.isArray(t.palette) || !t.palette.length) fail("palette", "must be a list of colours");
    t.palette.forEach((value, i) => colour(value, `palette[${i}]`));
  }
  // These two are written into the page's CSS as they are.
  if (t.radius !== undefined && !/^(0|\d*\.?\d+(px|rem|em))$/.test(String(t.radius))) fail("radius", "must be a length in px, rem or em, like 0.5rem");
  // An embedded file: there, small enough to carry in every page, and of a type the page can show.
  const embed = (value, key, types, maxKb) => {
    if (typeof value !== "string") fail(key, "must be a file path");
    const at = path.resolve(path.dirname(location), value);
    const [type, holds] = types[path.extname(at).toLowerCase()] ?? [];
    if (!type) fail(key, `${value} is not one of: ${Object.keys(types).join(", ")}`);
    const stat = fs.statSync(at, { throwIfNoEntry: false });
    if (!stat) fail(key, `file not found (${at})`);
    if (!stat.isFile()) fail(key, `${value} is not a file`);
    // The size is checked before the file is read.
    if (stat.size > maxKb * KB) fail(key, `${value} is ${Math.ceil(stat.size / KB)} KB; the limit is ${maxKb} KB`);
    const bytes = fs.readFileSync(at);
    if (!holds(bytes)) fail(key, `${value} is not a ${path.extname(at).slice(1).toUpperCase()} file (its content is something else)`);
    return `data:${type};base64,${bytes.toString("base64")}`;
  };
  let font;
  if (t.font !== undefined) {
    if (!isMap(t.font)) fail("font", "must be a mapping with `family` and, optionally, `file`");
    for (const key of Object.keys(t.font)) if (!["family", "file"].includes(key)) fail(`font.${key}`, "unknown key; the keys are: family, file");
    if (typeof t.font.family !== "string" || !t.font.family.trim() || /[;{}<>\\]/.test(t.font.family)) fail("font.family", 'must be a CSS font family list, like "Acme Sans, system-ui, sans-serif"');
    font = { family: t.font.family, file: t.font.file === undefined ? null : embed(t.font.file, "font.file", FONT_TYPES, 500) };
  }
  return { ...t, schemes, font, logo: t.logo === undefined ? null : embed(t.logo, "logo", LOGO_TYPES, 200) };
}

// `value` is the config's `theme`: a built-in name or a theme file relative to the config file.
// -> null without a theme, else { css, logo, schemes, palette }: the CSS for one <style> after the app CSS, the logo as a
// data: URL or null, the schemes the theme has ("light", "dark") and the chart series colours, if it sets them.
export function loadTheme(value, configDir) {
  if (value === undefined) return null;
  const builtIn = /^[a-z0-9-]+$/.test(value);
  const t = read(value, builtIn ? path.join(BUILT_IN, `${value}.yaml`) : path.resolve(configDir, value));
  const fallback = read("default", path.join(BUILT_IN, "default.yaml"));
  // Contrast of each pair as the page paints it: tokens the file leaves out come from the default theme, and a
  // translucent colour is composited over what lies under it: the header and the tiles (base-100) sit on the page
  // (base-200), the page on the browser's canvas.
  for (const scheme of t.schemes) {
    const token = name => parseColour(t[scheme][name] ?? fallback[scheme][name]);
    const page = over(token("base-100"), over(token("base-200"), scheme === "dark" ? [0, 0, 0] : [1, 1, 1]));
    for (const [text, surface] of CONTRAST_PAIRS) {
      const under = surface === "base-100" ? page : over(token(surface), page);
      const ratio = contrast(over(token(text), under), under);
      if (ratio < 4.5) console.error(`featherbi: warning: theme ${value}: ${text} on ${surface} (${scheme}) has a contrast of ${ratio.toFixed(2)}:1, below 4.5:1`);
    }
  }
  const radius = t.radius === undefined ? [] : ["box", "field", "selector"].map(part => `--radius-${part}:${t.radius}`);
  // Every token of a scheme is written: the light rule also matches in dark, so a token only light sets would leak there.
  const rules = t.schemes.map(scheme => `${SELECTOR[scheme]}{${[...Object.entries({ ...fallback[scheme], ...t[scheme] }).map(([token, colour]) => `--color-${token}:${colour}`), ...radius].join(";")}}`);
  if (t.font) {
    // The embedded file carries the first family of the list.
    if (t.font.file) rules.push(`@font-face{font-family:"${t.font.family.split(",")[0].trim().replace(/^["']|["']$/g, "")}";src:url(${t.font.file})}`);
    rules.push(`html{font-family:${t.font.family}}`);
  }
  // One scheme: nothing to switch to, so the toggle goes.
  if (t.schemes.length === 1) rules.push("label:has(#theme){display:none}");
  if (t.logo) rules.push(".fb-logo{height:2rem;width:auto;margin-inline-end:.75rem}");
  return { css: rules.join("\n"), logo: t.logo, schemes: t.schemes, palette: t.palette };
}

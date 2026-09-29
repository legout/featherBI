/**
 * Theme token validation and baking (spec 2026-09-28-0003 §3–§4, ADR 0008).
 *
 * validateThemeTokens(source, filename) parses one `theme.tokens.yaml`
 * (schema version 1), rejects unknown keys, malformed colors, unsafe font
 * stacks, and out-of-range values with `file:line:col` errors in the
 * established compiler style, and returns the normalized token set.
 * bakeTheme(tokens) bakes the validated tokens into the runtime theme
 * bundle `{name, css, echarts}`: scoped CSS variables (including the
 * supported AG Grid `--ag-*` mappings) plus a complete ECharts theme.
 * contrastWarnings(tokens, filename) checks the spec §5 pairs with WCAG
 * relative luminance ratios and returns one warning per below-target pair.
 */

import { LineCounter, parseDocument } from "yaml";

const SCHEMA_VERSION = 1;
const DEFAULT_FONT = "Inter, ui-sans-serif, system-ui, sans-serif";
const DEFAULT_RADIUS = 8;
const COLOR_TOKENS = [
 "surface",
 "surface2",
 "text",
 "textDim",
 "border",
 "accent",
 "accentContrast",
 "success",
 "warning",
 "danger",
];
const TOKEN_KEYS = new Set(["version", "font", "fontMono", "radius", "chart", ...COLOR_TOKENS]);
const CHART_KEYS = new Set(["palette", "heatMin"]);
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGBA_COLOR = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*\)$/;
// Font stacks reach CSS under the artifact CSP: no @import, no url(), no
// scheme or protocol-relative text.
const UNSAFE_FONT = /@import|url\s*\(|[a-z][a-z0-9+.-]*:|\/\/|\/\*|\*\/|[;{}]/i;
const SPLIT_LINE_ALPHA = 0.35;
const BAKED_THEME_NAME = "custom";
// Contrast targets per spec §5: text pairs 4.5:1, graphic/chart pairs 3:1.
const CONTRAST_TARGET_TEXT = 4.5;
const CONTRAST_TARGET_GRAPHIC = 3;

/**
 * Validate one theme token file and return normalized tokens.
 * @param {string} source raw `theme.tokens.yaml` text
 * @param {string} filename
 * @returns {object}
 */
export function validateThemeTokens(source, filename = "theme.tokens.yaml") {
 const lineCounter = new LineCounter();
 const document = parseDocument(source, {
  lineCounter,
  prettyErrors: false,
  strict: true,
  uniqueKeys: true,
 });
 if (document.errors.length > 0) {
  const error = document.errors[0];
  const position = error.linePos?.[0] ?? { line: 1, col: 1 };
  throw new Error(`${filename}:${position.line}:${position.col}: YAML ${error.message}`);
 }
 let data;
 try {
  data = document.toJS({ maxAliasCount: 0 });
 } catch (error) {
  throw new Error(`${filename}:1:1: YAML ${error.message}`, { cause: error });
 }
 const fail = (keyPath, message) => {
  throw tokenError(filename, document, lineCounter, keyPath, message);
 };
 if (data === null || typeof data !== "object" || Array.isArray(data)) {
  fail([], "theme tokens must be a YAML mapping");
 }
 if (data.version !== undefined && data.version !== SCHEMA_VERSION) {
  fail(["version"], `theme token "version" must be ${SCHEMA_VERSION}`);
 }
 for (const key of Object.keys(data)) {
  if (!TOKEN_KEYS.has(key)) fail([key], `unknown theme token key ${JSON.stringify(key)}`);
 }

 const tokens = { version: SCHEMA_VERSION };
 for (const key of COLOR_TOKENS) {
  if (data[key] === undefined) fail([key], `theme token ${JSON.stringify(key)} is required`);
  if (!isColor(data[key])) fail([key], colorMessage(key, data[key]));
  tokens[key] = data[key];
 }
 for (const key of ["font", "fontMono"]) {
  if (data[key] === undefined) continue;
  if (typeof data[key] !== "string" || UNSAFE_FONT.test(data[key])) {
   fail([key], `theme token ${JSON.stringify(key)} must be a font stack without @import, url(, scheme text, or CSS delimiters`);
  }
  tokens[key] = data[key];
 }
 if (tokens.font === undefined) tokens.font = DEFAULT_FONT;
 if (data.radius !== undefined) {
  if (!Number.isInteger(data.radius) || data.radius < 0 || data.radius > 24) {
   fail(["radius"], `theme token "radius" must be an integer from 0 through 24`);
  }
  tokens.radius = data.radius;
 } else {
  tokens.radius = DEFAULT_RADIUS;
 }
 if (data.chart === null || typeof data.chart !== "object" || Array.isArray(data.chart)) {
  fail(["chart"], "theme token \"chart\" must be a mapping with palette (and optional heatMin)");
 }
 for (const key of Object.keys(data.chart)) {
  if (!CHART_KEYS.has(key)) fail(["chart", key], `unknown theme token key ${JSON.stringify(key)}`);
 }
 if (data.chart.palette === undefined) {
  fail(["chart", "palette"], 'theme token "chart.palette" is required');
 }
 if (!Array.isArray(data.chart.palette) || data.chart.palette.length < 3 || data.chart.palette.length > 8) {
  fail(["chart", "palette"], 'theme token "chart.palette" must be an array of 3 through 8 colors');
 }
 tokens.chart = { palette: data.chart.palette.map((color, index) => {
  if (!isColor(color)) fail(["chart", "palette", index], colorMessage(`chart.palette[${index}]`, color));
  return color;
 }) };
 if (data.chart.heatMin !== undefined) {
  if (!isColor(data.chart.heatMin)) fail(["chart", "heatMin"], colorMessage("chart.heatMin", data.chart.heatMin));
  tokens.chart.heatMin = data.chart.heatMin;
 }
 return tokens;
}

/**
 * Bake validated tokens into the runtime theme bundle.
 * @param {object} tokens normalized output of validateThemeTokens
 * @returns {{name: string, css: string, echarts: object}}
 */
export function bakeTheme(tokens) {
 const palette = tokens.chart.palette;
 const heatMin = tokens.chart.heatMin ?? tokens.surface2;
 const fontMono = tokens.fontMono !== undefined ? `\n --fb-font-mono: ${tokens.fontMono};` : "";
 const css = `/* featherbi-theme:${BAKED_THEME_NAME}@tokens-v1 */
:root,
#dashboard {
 --fb-color-scheme: ${colorScheme(tokens.surface)};
 --fb-surface: ${tokens.surface};
 --fb-surface-2: ${tokens.surface2};
 --fb-text: ${tokens.text};
 --fb-text-dim: ${tokens.textDim};
 --fb-border: ${tokens.border};
 --fb-accent: ${tokens.accent};
 --fb-accent-contrast: ${tokens.accentContrast};
 --fb-success: ${tokens.success};
 --fb-warning: ${tokens.warning};
 --fb-danger: ${tokens.danger};
 --fb-radius: ${tokens.radius}px;
 --fb-font: ${tokens.font};${fontMono}
 --ag-background-color: ${tokens.surface};
 --ag-wrapper-background-color: ${tokens.surface};
 --ag-foreground-color: ${tokens.text};
 --ag-data-color: ${tokens.text};
 --ag-secondary-foreground-color: ${tokens.textDim};
 --ag-header-foreground-color: ${tokens.text};
 --ag-disabled-foreground-color: ${tokens.textDim};
 --ag-border-color: ${tokens.border};
 --ag-input-border-color: ${tokens.border};
 --ag-header-background-color: ${tokens.surface2};
 --ag-odd-row-background-color: ${tokens.surface};
}
`;
 const axisTheme = () => ({
  nameTextStyle: { color: tokens.textDim, fontFamily: tokens.font },
  axisLine: { lineStyle: { color: tokens.border } },
  axisTick: { lineStyle: { color: tokens.border } },
  axisLabel: { color: tokens.textDim, fontFamily: tokens.font },
  splitLine: { lineStyle: { color: splitLineColor(tokens.border) } },
 });
 return {
  name: BAKED_THEME_NAME,
  css,
  echarts: {
   color: [...palette],
   textStyle: { fontFamily: tokens.font, color: tokens.textDim },
   title: { textStyle: { color: tokens.text, fontFamily: tokens.font } },
   legend: { textStyle: { color: tokens.textDim, fontFamily: tokens.font } },
   categoryAxis: axisTheme(),
   valueAxis: axisTheme(),
   visualMap: {
    textStyle: { color: tokens.textDim, fontFamily: tokens.font },
    inRange: { color: [heatMin, palette[0]] },
   },
  },
 };
}

/** @returns {boolean} */
function isColor(value) {
 if (typeof value !== "string") return false;
 if (HEX_COLOR.test(value)) return true;
 const rgba = value.match(RGBA_COLOR);
 return Boolean(rgba) && Number(rgba[1]) <= 255 && Number(rgba[2]) <= 255 && Number(rgba[3]) <= 255;
}

function colorMessage(key, value) {
 return `theme token ${JSON.stringify(key)} must be a #rgb, #rrggbb, or rgba() color${
  typeof value === "string" ? ` (got ${JSON.stringify(value)})` : ""
 }`;
}

/** Split lines use the border color at reduced alpha; rgba() borders are used as-is (spec §4). */
function splitLineColor(border) {
 const rgba = border.match(RGBA_COLOR);
 if (rgba) return border;
 const [red, green, blue] = rgb(border);
 return `rgba(${red}, ${green}, ${blue}, ${SPLIT_LINE_ALPHA})`;
}

/** Dark native controls when the page surface is dark. */
function colorScheme(surface) {
 const [red, green, blue] = rgb(surface);
 return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 < 0.5 ? "dark" : "light";
}

/** @returns {[number, number, number]} */
function rgb(color) {
 const hex = color.replace("#", "");
 const full = hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex;
 return [
  Number.parseInt(full.slice(0, 2), 16),
  Number.parseInt(full.slice(2, 4), 16),
  Number.parseInt(full.slice(4, 6), 16),
 ];
}

/**
 * Contrast warnings per spec §5, computed with WCAG relative luminance.
 * Pairs: text/surface, textDim/surface, accentContrast/accent (4.5:1);
 * accent/surface and each chart.palette entry/surface (3:1). Returns one
 * warning per below-target pair; contrast never fails the build.
 * @param {object} tokens normalized output of validateThemeTokens
 * @param {string} filename
 * @returns {string[]}
 */
export function contrastWarnings(tokens, filename = "theme.tokens.yaml") {
 const warnings = [];
 const check = (pair, foreground, background, target) => {
  const ratio = contrastRatio(foreground, background);
  if (ratio < target) {
   warnings.push(
    `${filename}: warning: contrast ${pair} is ${ratio.toFixed(2)}:1, below the ${target}:1 target`,
   );
  }
 };
 check("text/surface", tokens.text, tokens.surface, CONTRAST_TARGET_TEXT);
 check("textDim/surface", tokens.textDim, tokens.surface, CONTRAST_TARGET_TEXT);
 check("accentContrast/accent", tokens.accentContrast, tokens.accent, CONTRAST_TARGET_TEXT);
 check("accent/surface", tokens.accent, tokens.surface, CONTRAST_TARGET_GRAPHIC);
 tokens.chart.palette.forEach((color, index) => {
  check(`chart.palette[${index}]/surface`, color, tokens.surface, CONTRAST_TARGET_GRAPHIC);
 });
 return warnings;
}

/** WCAG contrast ratio of two colors (lighter/darker luminance, both + 0.05). */
function contrastRatio(foreground, background) {
 // ponytail: rgba foregrounds are measured composited over the pair
 // background; a translucent background token is measured as its own rgb —
 // whatever sits beneath the page surface is out of scope.
 const [red, green, blue, alpha] = channels(foreground);
 const backdrop = channels(background).slice(0, 3);
 const blended = [red, green, blue].map(
  (channel, index) => alpha * channel + (1 - alpha) * backdrop[index],
 );
 const lighter = Math.max(luminance(blended), luminance(backdrop));
 const darker = Math.min(luminance(blended), luminance(backdrop));
 return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG relative luminance of an sRGB color. */
function luminance([red, green, blue]) {
 const linear = (channel) => {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
 };
 return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** @returns {[number, number, number, number]} r, g, b channels plus alpha (1 for hex). */
function channels(color) {
 const rgba = color.match(RGBA_COLOR);
 if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
 const [red, green, blue] = rgb(color);
 return [red, green, blue, 1];
}

/** Error carrying filename/line/column for one token key path. */
function tokenError(filename, document, lineCounter, keyPath, message) {
 let node = keyPath.length > 0 ? document.getIn(keyPath, true) : null;
 if (!node && keyPath.length > 1) node = document.getIn(keyPath.slice(0, -1), true);
 const position = lineCounter.linePos(node?.range?.[0] ?? 0);
 return new Error(`${filename}:${position.line}:${position.col}: ${message}`);
}

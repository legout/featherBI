import postcss from "postcss";
import prefixSelector from "postcss-prefix-selector";

const ALLOWED_AT_RULES = new Set(["media", "supports", "layer", "keyframes", "-webkit-keyframes", "property", "container", "font-face"]);
const REQUIRED_UI = /#(?:dashboard-status|dashboard-sources|replace-files|active-filter-state)\b/i;
const SHADOW_PIERCING = /(?:\/deep\/|>>>|::shadow)/i;

/** Validate trusted author CSS, then scope it under the dashboard root. */
export async function scopeThemeCss(css, filename = "theme.css") {
 let root;
 try {
  root = postcss.parse(css, { from: filename });
 } catch (error) {
  throw new Error(`${filename}:${error.line ?? 1}:${error.column ?? 1}: ${error.reason ?? error.message}`, { cause: error });
 }
 root.walkAtRules((rule) => {
  if (!ALLOWED_AT_RULES.has(rule.name.toLowerCase())) throw rule.error(`@${rule.name} is not allowed`);
 });
 root.walkRules((rule) => {
  const selector = normalizeCss(rule.selector);
  if (SHADOW_PIERCING.test(selector)) throw rule.error("shadow-piercing selectors are not allowed");
  if (REQUIRED_UI.test(selector)) throw rule.error("required dashboard controls and status cannot be restyled");
 });
 root.walkDecls((decl) => {
  const property = normalizeCss(decl.prop).toLowerCase();
  const value = normalizeCss(decl.value).toLowerCase();
  if (property === "behavior" || property === "-moz-binding") throw decl.error(`${decl.prop} is not allowed`);
  if (/\b(?:https?:|data:|blob:|\/\/)/i.test(value) || /image-set\s*\(/i.test(value)) throw decl.error("network-loading values are not allowed");
  for (const match of value.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
   if (!match[2].startsWith("#")) throw decl.error("non-fragment URLs are not allowed");
  }
  if ((property === "display" && value === "none") || (property === "visibility" && value === "hidden") || (property === "opacity" && /^0(?:\.0*)?$/.test(value))) {
   throw decl.error("author CSS cannot hide dashboard UI");
  }
 });
 const result = await postcss([
  prefixSelector({
   prefix: "#dashboard",
   transform(prefix, selector, prefixed) {
    if (/^(?::root|html|body)$/.test(selector.trim())) return prefix;
    return selector.trim().startsWith(prefix) ? selector : prefixed;
   },
  }),
 ]).process(root, { from: filename });
 return `${result.css.trim()}\n`;
}

function normalizeCss(value) {
 return String(value)
  .replaceAll(/\/\*[\s\S]*?\*\//g, "")
  .replaceAll(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_match, hex, escaped) => escaped ?? String.fromCodePoint(Number.parseInt(hex, 16)));
}

/**
 * Safe-subset Markdown renderer for `markdown` content components
 * ("Content component behavior" in the runtime interaction spec):
 *
 * - paragraphs (blank-line separated blocks; lines joined by one space)
 * - emphasis `*italic*` and `**bold**` (may nest; `_` is not a marker)
 * - unordered lists: one item per line starting `- `
 * - ordered lists: one item per line starting `N. ` (numbered from `N`)
 * - links `[label](destination)` where destination is `https://`, `http://`,
 *   or `mailto:`; opened isolated from the dashboard
 *
 * Every node is built through `createElement`/text content only; source text
 * is never parsed as HTML. Raw HTML, images, and any other construct stay
 * literal text, and disallowed link destinations stay text with no anchor.
 */

const LINK_SCHEME = /^(?:https:\/\/|http:\/\/|mailto:)/i;
const INLINE_TOKEN = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]*)\]\(([^)\s]+)\)/g;
const UNORDERED_ITEM = /^- /;
const ORDERED_ITEM = /^(\d{1,9})\. /;

/**
 * Append the rendered safe subset of `source` as DOM nodes to `parent`.
 *
 * @param {HTMLElement} parent
 * @param {string} source
 */
export function appendMarkdown(parent, source) {
 const blocks = [];
 let block = null;
 for (const line of String(source ?? "")
  .replaceAll("\r\n", "\n")
  .split("\n")) {
  if (line.trim() === "") {
   block = null;
  } else {
   if (!block) {
    block = [];
    blocks.push(block);
   }
   block.push(line);
  }
 }
 for (const lines of blocks) {
  const unordered = lines.every((line) => UNORDERED_ITEM.test(line));
  const ordered = !unordered && lines.every((line) => ORDERED_ITEM.test(line));
  if (unordered || ordered) {
   const list = document.createElement(ordered ? "ol" : "ul");
   if (ordered) list.start = Number(ORDERED_ITEM.exec(lines[0])[1]);
   for (const line of lines) {
    const item = document.createElement("li");
    appendInline(item, line.replace(ordered ? ORDERED_ITEM : UNORDERED_ITEM, ""));
    list.append(item);
   }
   parent.append(list);
  } else {
   const paragraph = document.createElement("p");
   appendInline(paragraph, lines.join(" "));
   parent.append(paragraph);
  }
 }
}

/**
 * Append `text` to `parent` with emphasis and allowed links applied; every
 * other character (including raw HTML and image/link syntax that is not an
 * allowed link) becomes a literal text node.
 *
 * @param {HTMLElement} parent
 * @param {string} text
 */
function appendInline(parent, text) {
 let index = 0;
 for (const match of text.matchAll(INLINE_TOKEN)) {
  const [token, strong, emphasis, label, destination] = match;
  if (match.index > index) parent.append(text.slice(index, match.index));
  const isImage = match.index > 0 && text[match.index - 1] === "!";
  if (destination !== undefined) {
   if (!isImage && LINK_SCHEME.test(destination)) {
    const anchor = document.createElement("a");
    anchor.href = destination;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    appendInline(anchor, label);
    parent.append(anchor);
   } else {
    parent.append(token);
   }
  } else {
   const element = document.createElement(
    strong !== undefined ? "strong" : "em",
   );
   appendInline(element, strong ?? emphasis);
   parent.append(element);
  }
  index = match.index + token.length;
 }
 if (index < text.length) parent.append(text.slice(index));
}

import { Parser } from "extended-markdown-adf-parser";

const parser = new Parser();

/**
 * Converts a markdown string into a Confluence ADF document.
 *
 * Confluence lets a table cell hold multiple paragraphs (e.g. from pressing
 * Cmd+Enter inside a cell to break the paragraph without leaving the cell).
 * The underlying parser has no markdown syntax for that on the way in, even
 * though it renders such a cell as "<br>"-joined text on the way out. So a
 * literal "<br>" inside a table cell is reinterpreted here as the paragraph
 * break it came from, instead of being left as literal, unparsed text.
 */
export function markdownToAdf(markdown) {
  return splitTableCellLineBreaks(parser.markdownToAdf(markdown));
}

/**
 * Converts a Confluence ADF document into a markdown string.
 *
 * Real Confluence pages carry editor bookkeeping on every node (a `localId`
 * for commenting, pixel-based `width`/`colwidth`, and default `colspan`:1 /
 * `rowspan`:1 on every unmerged table cell). The underlying parser has no
 * equivalent markdown syntax for these, so by default it preserves them as
 * inline `<!-- adf:... -->` comments to stay fully round-trip safe, which
 * makes the output unreadable. None of that carries semantic meaning for
 * our purposes, so it's stripped before conversion; Confluence re-assigns
 * fresh values for all of it the next time the page is edited there.
 *
 * Node types the parser doesn't know how to render as markdown at all
 * (e.g. Confluence macros like a table-of-contents) fall back to a raw ADF
 * JSON dump wrapped in an `<!-- adf:unknown -->` comment, which the parser
 * also can't read back in. Those are rendered as a plain ```json code
 * block instead: it's not a perfect round trip (pushing it back recreates
 * a static code block, not the live macro), but it's stable and readable,
 * instead of being silently mangled on the next push.
 */
export function adfToMarkdown(adf) {
  return stripHardBreakPadding(
    rewriteUnknownNodeFallbacks(parser.adfToMarkdown(stripEditorOnlyAttrs(adf)))
  );
}

function stripEditorOnlyAttrs(node) {
  if (Array.isArray(node)) {
    return node.map(stripEditorOnlyAttrs);
  }

  if (node === null || typeof node !== "object") {
    return node;
  }

  const cloned = { ...node };

  if (cloned.attrs) {
    const attrs = { ...cloned.attrs };
    delete attrs.localId;
    delete attrs.colwidth;

    if (cloned.type === "table") {
      delete attrs.width;
    }

    if (cloned.type === "tableCell" || cloned.type === "tableHeader") {
      if (attrs.colspan === 1) {
        delete attrs.colspan;
      }
      if (attrs.rowspan === 1) {
        delete attrs.rowspan;
      }
    }

    if (cloned.type === "codeBlock") {
      delete attrs.wrap;
    }

    cloned.attrs = attrs;
  }

  if (cloned.content) {
    cloned.content = stripEditorOnlyAttrs(cloned.content);
  }

  if (cloned.marks) {
    cloned.marks = stripEditorOnlyAttrs(cloned.marks);
  }

  return cloned;
}

const UNKNOWN_NODE_FALLBACK =
  /<!-- adf:unknown type="[a-zA-Z0-9_-]+" -->\n([\s\S]*?)\n<!-- \/adf:unknown -->/g;

function rewriteUnknownNodeFallbacks(markdown) {
  return markdown.replace(
    UNKNOWN_NODE_FALLBACK,
    (_match, json) => "```json\n" + json + "\n```"
  );
}

/**
 * A hardBreak renders as "  \n" (its own standard markdown hard-break syntax:
 * two trailing spaces before the newline); inside a table cell, that newline
 * then gets turned into "<br>", leaving its 2 leading spaces behind in the
 * visible text. Left in place, those 2 spaces would accumulate by 2 more on
 * every future push/pull cycle, so they're stripped back out here.
 */
function stripHardBreakPadding(markdown) {
  return markdown.replace(/ {2}<br>/g, "<br>");
}

function splitTableCellLineBreaks(node) {
  if (Array.isArray(node)) {
    return node.map(splitTableCellLineBreaks);
  }

  if (node === null || typeof node !== "object") {
    return node;
  }

  const cloned = { ...node };

  if (
    (cloned.type === "tableCell" || cloned.type === "tableHeader") &&
    Array.isArray(cloned.content)
  ) {
    cloned.content = replaceBrMarkersWithHardBreak(cloned.content);
  } else if (cloned.content) {
    cloned.content = splitTableCellLineBreaks(cloned.content);
  }

  return cloned;
}

/**
 * A literal "<br>" inside a table cell doesn't parse as inline text or as a
 * hardBreak: it comes back as its own paragraph node whose only child is the
 * literal text "[HTML: <br>]" (the parser's generic fallback for raw inline
 * HTML it doesn't recognize), interleaved with the cell's other inline nodes.
 * Replacing it with an actual `hardBreak` node (the ADF node Confluence
 * itself uses for a Cmd+Enter break inside a cell) is what makes the cell
 * render as "<br>"-joined text again the next time it's fetched.
 */
function isBrMarker(node) {
  return (
    node.type === "paragraph" &&
    Array.isArray(node.content) &&
    node.content.length === 1 &&
    node.content[0].type === "text" &&
    node.content[0].text === "[HTML: <br>]"
  );
}

function replaceBrMarkersWithHardBreak(cellContent) {
  return cellContent.flatMap((node) =>
    isBrMarker(node) ? [{ type: "hardBreak" }] : [node]
  );
}

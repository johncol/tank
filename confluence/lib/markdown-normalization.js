/**
 * Pre-normalizes markdown that's semantically fine but would otherwise fail
 * the round-trip safety check in adapter.js's isRoundTripSafe, purely over
 * formatting the ADF round trip (see markdown.js) normalizes on its own --
 * a bare URL, a loosely-spaced table separator, or a heading or nested list
 * missing a blank line.
 *
 * Add new rules here, not in markdown.js: each one is a small, independent
 * "markdown round-trips to a different but equivalent markdown" fact about
 * the underlying extended-markdown-adf-parser, discovered the same way --
 * writing a snippet, round-tripping it through markdownToAdf/adfToMarkdown,
 * and diffing the result against the original. Wire a new rule into
 * normalizeMarkdown's pipeline below, protecting it from (and protecting
 * other rules from) anything it shouldn't touch, the same way the existing
 * rules do.
 */

/**
 * Pulls every match of `pattern` out of `text`, replacing each with a
 * unique placeholder, so later steps can't see or touch it. Returns the
 * placeholdered text and a `restore` function that puts the originals back,
 * applied once every other normalization has run.
 *
 * Each call gets its own random nonce in its placeholders, so nesting
 * multiple `protect` calls (as `normalizeMarkdown` does) can never have one
 * call's `restore` match a placeholder left by another.
 */
function protect(text, pattern) {
  const nonce = Math.random().toString(36).slice(2);
  const saved = [];

  const placeheld = text.replace(pattern, (match) => {
    const token = `\u0000${nonce}-${saved.length}\u0000`;
    saved.push(match);
    return token;
  });

  const restore = (withText) =>
    withText.replace(
      new RegExp(`\\u0000${nonce}-(\\d+)\\u0000`, "g"),
      (_match, index) => saved[Number(index)]
    );

  return { placeheld, restore };
}

const FENCED_CODE_BLOCK_PATTERN = /^```.*$[\s\S]*?^```[ \t]*$/gm;
const INLINE_CODE_PATTERN = /`[^`\n]+`/g;
const EXISTING_LINK_PATTERN = /\[[^\]\n]*\]\([^)\n]*\)/g;
const AUTOLINK_OR_BARE_URL_PATTERN =
  /<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()[\]]+)/g;
const LIST_ITEM_PATTERN = /^(\s*)(?:[-*+]|\d+[.)])\s+\S/;
const HEADING_PATTERN = /^(\s*)#{1,6}\s+\S/;
const TABLE_SEPARATOR_ROW_PATTERN =
  /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Rewrites bare "https://..." URLs, and "<https://...>" autolinks, as
 * explicit `[url](url)` link syntax. Either one still becomes a real link in
 * Confluence's ADF, but round-tripping back out of ADF always renders a link
 * with explicit `[url](url)` text (see adfToMarkdown's doc comment for why
 * there's no ADF syntax for an "implicit" link) -- so neither form round-trips
 * as itself. Fenced code, inline code, and already-explicit `[text](url)`
 * links are left untouched.
 *
 * Both forms are matched and rewritten in one pass: matching them separately
 * would have the bare-URL rule re-match (and double-wrap) the URL text an
 * earlier autolink rule had just wrapped in `[url](url)`.
 */
function linkifyBareUrls(markdown) {
  return markdown.replace(
    AUTOLINK_OR_BARE_URL_PATTERN,
    (_match, autolinkUrl, bareUrl) => {
      const url = autolinkUrl ?? bareUrl;
      return `[${url}](${url})`;
    }
  );
}

/**
 * Rewrites every markdown table separator row (e.g. "|---|:--:|---:|") to
 * the one canonical form ADF round-trips to: "| -------- | -------- |",
 * one 8-dash cell per column. Confluence's ADF has no concept of column
 * alignment, so the parser drops any ":" alignment markers on the way
 * through -- normalizing them here up front avoids a round-trip mismatch
 * over formatting that was going to be discarded anyway.
 */
function normalizeTableSeparators(markdown) {
  return markdown
    .split("\n")
    .map((line) => {
      if (!TABLE_SEPARATOR_ROW_PATTERN.test(line) || !line.includes("-")) {
        return line;
      }

      const columns = line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|").length;

      return `| ${Array(columns).fill("--------").join(" | ")} |`;
    })
    .join("\n");
}

function indentWidth(line) {
  return line.match(/^\s*/)[0].length;
}

/**
 * Inserts the blank line the ADF round trip always adds (and therefore
 * requires on the way in) at two block boundaries that are otherwise valid,
 * tighter markdown:
 *
 * - Immediately before or after a heading, when its neighbor isn't already
 *   blank-separated.
 * - Immediately before a list item whose previous line isn't a list item at
 *   the very same indentation -- i.e. the first line of a new list, or of a
 *   more deeply nested one, started right after other content.
 *
 * Lines inside list items that stay siblings at their own depth (the common
 * case) are left tight, matching what the round trip leaves alone.
 */
function insertMissingBlankLines(markdown) {
  const lines = markdown.split("\n");
  const result = [];

  // Indentation of each currently open nested list level, outermost first.
  // Tracks real list nesting (not just the previous line's indentation) so
  // a list item's wrapped continuation text -- itself indented deeper than
  // its own marker -- doesn't get mistaken for a different nesting level
  // when the next sibling item follows it.
  let openListIndents = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    result.push(line);

    const lineIsHeading = HEADING_PATTERN.test(line);
    const lineIsBlank = line.trim() === "";

    if (lineIsBlank || lineIsHeading) {
      // A blank line or heading always ends whatever list preceded it.
      openListIndents = [];
    } else if (LIST_ITEM_PATTERN.test(line)) {
      const indent = indentWidth(line);

      while (
        openListIndents.length > 0 &&
        openListIndents[openListIndents.length - 1] > indent
      ) {
        openListIndents.pop();
      }

      if (openListIndents[openListIndents.length - 1] !== indent) {
        openListIndents.push(indent);
      }
    }

    const next = lines[i + 1];

    // Already blank on either side of this boundary: nothing to add.
    if (next === undefined || next.trim() === "" || lineIsBlank) {
      continue;
    }

    const nextIsHeading = HEADING_PATTERN.test(next);
    const nextIsListItem = LIST_ITEM_PATTERN.test(next);
    let needsBlankBeforeList = false;

    if (nextIsListItem) {
      const nextIndent = indentWidth(next);
      let depth = openListIndents.length - 1;

      while (depth >= 0 && openListIndents[depth] > nextIndent) {
        depth--;
      }

      const isSibling = depth >= 0 && openListIndents[depth] === nextIndent;
      needsBlankBeforeList = !isSibling;
    }

    const needsBlankLine =
      lineIsHeading ||
      (nextIsHeading && !lineIsHeading) ||
      needsBlankBeforeList;

    if (needsBlankLine) {
      result.push("");
    }
  }

  return result.join("\n");
}

/**
 * Fixes up markdown that's semantically fine but would otherwise fail the
 * round-trip safety check over formatting the ADF round trip normalizes on
 * its own -- a bare URL, a loosely-spaced table separator, or a heading or
 * nested list missing the blank line ADF always adds back. Applying this
 * before the round-trip check (and before converting for real) means a push
 * or create only has to fail over changes that would actually be lossy.
 *
 * Fenced code blocks, inline code spans, and existing links/autolinks are
 * protected throughout, so nothing inside them is rewritten.
 */
export function normalizeMarkdown(markdown) {
  const code = protect(markdown, FENCED_CODE_BLOCK_PATTERN);
  const inlineCode = protect(code.placeheld, INLINE_CODE_PATTERN);
  const links = protect(inlineCode.placeheld, EXISTING_LINK_PATTERN);

  const linkified = linkifyBareUrls(links.placeheld);
  const tablesNormalized = normalizeTableSeparators(linkified);
  const blankLinesFixed = insertMissingBlankLines(tablesNormalized);

  return code.restore(inlineCode.restore(links.restore(blankLinesFixed)));
}

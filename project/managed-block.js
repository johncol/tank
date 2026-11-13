/** The line opening the block tank owns in a project's markdown files. */
export const MANAGED_BLOCK_START = "<!-- tank:start -->";

/** The line closing the block tank owns in a project's markdown files. */
export const MANAGED_BLOCK_END = "<!-- tank:end -->";

/**
 * Builds a managed block, markers included.
 * @param {string} blockContent The markdown between the markers, ending
 *   with a newline.
 * @returns {string}
 */
export function buildManagedBlock(blockContent) {
  return `${MANAGED_BLOCK_START}\n${blockContent}${MANAGED_BLOCK_END}\n`;
}

/**
 * Puts the managed block in a markdown file's content: replaces what's
 * between its markers (keeping the marker lines), or appends the block
 * after a blank line when the content has no markers. Everything outside
 * the block stays as it is.
 *
 * @param {string} content The file's current content.
 * @param {string} blockContent The markdown between the markers, ending
 *   with a newline.
 * @returns {string} The new content, the same when the block is up to date.
 * @throws {Error} When the markers aren't exactly one start line followed
 *   by one end line, since tank can't tell which part it owns.
 */
export function applyManagedBlock(content, blockContent) {
  const lines = content.split("\n");
  const startIndexes = findLineIndexes(lines, MANAGED_BLOCK_START);
  const endIndexes = findLineIndexes(lines, MANAGED_BLOCK_END);

  if (startIndexes.length === 0 && endIndexes.length === 0) {
    const contentWithoutTrailingNewlines = content.replace(/\n+$/, "");

    if (contentWithoutTrailingNewlines === "") {
      return buildManagedBlock(blockContent);
    }

    return `${contentWithoutTrailingNewlines}\n\n${buildManagedBlock(blockContent)}`;
  }

  const hasOneMarkerEach = startIndexes.length === 1 && endIndexes.length === 1;

  if (!hasOneMarkerEach || endIndexes[0] < startIndexes[0]) {
    const found = hasOneMarkerEach
      ? "the end line before the start line"
      : `${startIndexes.length} start and ${endIndexes.length} end lines`;

    throw new Error(
      `Malformed tank block: expected one "${MANAGED_BLOCK_START}" line followed by ` +
        `one "${MANAGED_BLOCK_END}" line, found ${found}. ` +
        'Fix the markers by hand, then run "tank upgrade" again.'
    );
  }

  const linesThroughStart = lines.slice(0, startIndexes[0] + 1);
  const linesFromEnd = lines.slice(endIndexes[0]);

  return `${linesThroughStart.join("\n")}\n${blockContent}${linesFromEnd.join("\n")}`;
}

/**
 * @param {string[]} lines
 * @param {string} marker
 * @returns {number[]} The indexes of the lines holding only the marker.
 */
function findLineIndexes(lines, marker) {
  const indexes = [];

  for (const [index, line] of lines.entries()) {
    if (line.trim() === marker) {
      indexes.push(index);
    }
  }

  return indexes;
}

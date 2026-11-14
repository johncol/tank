/**
 * Wraps paragraphs of words into lines no longer than `width`, continuing
 * `firstLine` and starting every next line with `indent`. A line as long as
 * `indent` is empty, so its first word isn't preceded by a space, and a word
 * too long for any line gets a line of its own. Each paragraph after the
 * first starts on a new line.
 *
 * @param {string[]} paragraphs
 * @param {Object} options
 * @param {string} options.firstLine The line the first word continues.
 * @param {string} options.indent What every next line starts with.
 * @param {number} options.width The longest a line gets, unless a single
 *   word is longer.
 * @returns {string} The lines, joined by newlines.
 */
export function wrapText(paragraphs, { firstLine, indent, width }) {
  const lines = [firstLine];

  paragraphs.forEach((paragraph, index) => {
    if (index > 0) {
      lines.push(indent);
    }

    for (const word of paragraph.split(" ")) {
      const lastLine = lines[lines.length - 1];
      const isLineStart = lastLine.length === indent.length;
      const candidate = isLineStart ? lastLine + word : `${lastLine} ${word}`;

      if (candidate.length > width && !isLineStart) {
        lines.push(indent + word);
      } else {
        lines[lines.length - 1] = candidate;
      }
    }
  });

  return lines.join("\n");
}

import test from "node:test";
import assert from "node:assert/strict";
import { markdownToAdf, adfToMarkdown } from "../markdown.js";
import { normalizeMarkdown } from "../markdown-normalization.js";

test("normalizeMarkdown wraps a bare URL in explicit link syntax", () => {
  const markdown = "JIRA Task: https://example.com/browse/AT2-2710";

  assert.equal(
    normalizeMarkdown(markdown),
    "JIRA Task: [https://example.com/browse/AT2-2710](https://example.com/browse/AT2-2710)"
  );
});

test("normalizeMarkdown rewrites a <url> autolink the same way", () => {
  const markdown = "See <https://example.com> for details.";

  assert.equal(
    normalizeMarkdown(markdown),
    "See [https://example.com](https://example.com) for details."
  );
});

test("normalizeMarkdown leaves a bare URL alone inside fenced code or an inline code span", () => {
  const fenced = "```\ncurl https://example.com\n```";
  const inline = "Run `curl https://example.com` locally.";

  assert.equal(normalizeMarkdown(fenced), fenced);
  assert.equal(normalizeMarkdown(inline), inline);
});

test("normalizeMarkdown leaves an already-explicit link alone", () => {
  const markdown = "[Example](https://example.com)";

  assert.equal(normalizeMarkdown(markdown), markdown);
});

test("normalizeMarkdown rewrites a table separator row to the canonical 8-dash form, dropping alignment markers", () => {
  const markdown = "| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |";

  assert.equal(
    normalizeMarkdown(markdown),
    "| A | B | C |\n| -------- | -------- | -------- |\n| 1 | 2 | 3 |"
  );
});

test("normalizeMarkdown inserts a blank line between a heading and tightly-following content", () => {
  assert.equal(
    normalizeMarkdown("## Heading\n- item 1\n- item 2"),
    "## Heading\n\n- item 1\n- item 2"
  );
  assert.equal(
    normalizeMarkdown("Some para\n## Heading"),
    "Some para\n\n## Heading"
  );
});

test("normalizeMarkdown inserts a blank line before a nested list's first item, but not between its own siblings", () => {
  assert.equal(
    normalizeMarkdown("- item\n  - nested a\n  - nested b"),
    "- item\n\n  - nested a\n  - nested b"
  );
});

test("normalizeMarkdown leaves a tight list's own siblings alone, even across a wrapped item's continuation text", () => {
  const markdown =
    "- **Why 30m**: text\n  wrapped\n  more wrapped.\n- Next sibling item";

  assert.equal(normalizeMarkdown(markdown), markdown);
});

test("normalizeMarkdown's output is itself round-trip safe for every pattern it rewrites", () => {
  const markdown =
    "# Title\n" +
    "JIRA Task: https://example.com/AT2-1\n" +
    "## Section\n" +
    "- Back-tested two cases:\n" +
    "  - case one\n" +
    "  - case two\n" +
    "- Next point\n" +
    "\n" +
    "| Event | Result |\n" +
    "| --- | --- |\n" +
    "| one | pass |";

  const normalized = normalizeMarkdown(markdown);

  assert.equal(adfToMarkdown(markdownToAdf(normalized)), normalized);
});

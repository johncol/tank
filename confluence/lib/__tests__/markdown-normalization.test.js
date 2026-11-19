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

test("normalizeMarkdown joins a paragraph hard-wrapped across lines into one line", () => {
  const markdown =
    "This is a paragraph\nthat was hard-wrapped\nacross three lines.";

  assert.equal(
    normalizeMarkdown(markdown),
    "This is a paragraph that was hard-wrapped across three lines."
  );
});

test("normalizeMarkdown stops joining at a blank line, keeping paragraphs separate", () => {
  const markdown = "First paragraph\nwrapped.\n\nSecond paragraph\nwrapped.";

  assert.equal(
    normalizeMarkdown(markdown),
    "First paragraph wrapped.\n\nSecond paragraph wrapped."
  );
});

test("normalizeMarkdown preserves an explicit hard break (trailing two spaces) instead of joining across it", () => {
  const markdown = "line one  \nline two\nline three";

  assert.equal(normalizeMarkdown(markdown), "line one  \nline two line three");
});

test("normalizeMarkdown preserves an explicit hard break (trailing backslash) instead of joining across it", () => {
  const markdown = "line one\\\nline two";

  assert.equal(normalizeMarkdown(markdown), "line one\\\nline two");
});

test("normalizeMarkdown doesn't join across a heading, list item, blockquote, or table row", () => {
  assert.equal(
    normalizeMarkdown("Some para\n## Heading\nmore para"),
    "Some para\n\n## Heading\n\nmore para"
  );
  assert.equal(
    normalizeMarkdown("Some para\n- a list item"),
    "Some para\n\n- a list item"
  );
  assert.equal(
    normalizeMarkdown("Some para\n> a quote"),
    "Some para\n> a quote"
  );
  assert.equal(
    normalizeMarkdown("Some para\n| a | b |"),
    "Some para\n| a | b |"
  );
});

test("normalizeMarkdown doesn't join a Setext H1 heading's title into its underline", () => {
  const h1 = "A Title\n=======";

  assert.equal(normalizeMarkdown(h1), h1);
});

test("normalizeMarkdown leaves a tight list's own wrapped continuation text alone (indented, not plain paragraph)", () => {
  const markdown =
    "- **Why 30m**: text\n  wrapped\n  more wrapped.\n- Next sibling item";

  assert.equal(normalizeMarkdown(markdown), markdown);
});

test("normalizeMarkdown doesn't join a fenced code block into prose that abuts it with no blank line", () => {
  const markdown = "Some intro text\n```\ncode line\n```\nMore text";

  assert.equal(normalizeMarkdown(markdown), markdown);
});

test("normalizeMarkdown doesn't join a *** or ___ thematic break into surrounding prose", () => {
  assert.equal(
    normalizeMarkdown("Some text\n***\nmore text"),
    "Some text\n***\nmore text"
  );
  assert.equal(
    normalizeMarkdown("Some text\n___\nmore text"),
    "Some text\n___\nmore text"
  );
});

test("normalizeMarkdown's output is itself round-trip safe for every pattern it rewrites", () => {
  const markdown =
    "# Title\n" +
    "This paragraph was\n" +
    "hard-wrapped by hand\n" +
    "across lines.\n" +
    "\n" +
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

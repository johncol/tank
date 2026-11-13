import test from "node:test";
import assert from "node:assert/strict";
import { markdownToAdf, adfToMarkdown } from "../markdown.js";

test("adfToMarkdown(markdownToAdf(x)) round-trips simple markdown unchanged", () => {
  const original =
    "## Heading\n\nA paragraph with **bold** text and a [link](https://example.com).";

  const roundTripped = adfToMarkdown(markdownToAdf(original));

  assert.equal(roundTripped, original);
});

test("adfToMarkdown strips editor-only bookkeeping attrs (localId, pixel widths, default colspan/rowspan)", () => {
  // Shaped like a real Confluence page: every node carries a localId, table
  // cells carry pixel colwidth and default colspan/rowspan of 1, and the
  // table itself carries a pixel width.
  const adf = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "table",
        attrs: { width: 760, localId: "table-1" },
        content: [
          {
            type: "tableRow",
            attrs: { localId: "row-1" },
            content: [
              {
                type: "tableCell",
                attrs: {
                  colspan: 1,
                  rowspan: 1,
                  colwidth: [200],
                  localId: "cell-1",
                },
                content: [
                  {
                    type: "paragraph",
                    attrs: { localId: "p-1" },
                    content: [{ type: "text", text: "a" }],
                  },
                ],
              },
              {
                // A genuinely merged cell: colspan must survive stripping.
                type: "tableCell",
                attrs: {
                  colspan: 2,
                  rowspan: 1,
                  colwidth: [200, 200],
                  localId: "cell-2",
                },
                content: [
                  {
                    type: "paragraph",
                    attrs: { localId: "p-2" },
                    content: [{ type: "text", text: "b" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const markdown = adfToMarkdown(adf);

  assert.ok(
    !markdown.includes("localId"),
    "localId should never survive conversion"
  );
  assert.ok(
    !markdown.includes("colwidth"),
    "pixel colwidth should never survive conversion"
  );
  assert.ok(
    !markdown.includes('"width":760'),
    "pixel table width should never survive conversion"
  );
  assert.ok(
    markdown.includes("2"),
    "a genuine colspan of 2 (merged cell) must still be represented"
  );
});

test("markdownToAdf turns a literal <br> inside a table cell into a hardBreak node", () => {
  const markdown = "| A | B |\n| --- | --- |\n| x<br>y | z |\n";

  const adf = markdownToAdf(markdown);
  const [cellA] = adf.content[0].content[1].content;

  assert.deepEqual(
    cellA.content.map((node) => node.type),
    ["text", "hardBreak", "text"]
  );
});

test("adfToMarkdown renders a hardBreak inside a table cell back as a literal <br>", () => {
  const adf = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  { type: "text", text: "x" },
                  { type: "hardBreak" },
                  { type: "text", text: "y" },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const markdown = adfToMarkdown(adf);

  assert.match(markdown, /x\s*<br>y/);
});

test("a table cell's <br> stays stable across repeated push/pull cycles (hardBreak padding doesn't accumulate)", () => {
  const markdown = "| A |\n| --- |\n| x    <br>y |\n";

  // Round-trip once first to settle into the library's own canonical formatting
  // (table separator width, trailing newline), then check it stays put from there.
  const settled = adfToMarkdown(markdownToAdf(markdown));
  const roundTrippedAgain = adfToMarkdown(markdownToAdf(settled));

  assert.equal(roundTrippedAgain, settled);
});

test("adfToMarkdown renders an unrecognized node type (e.g. a Confluence macro) as a ```json code block", () => {
  const adf = {
    type: "doc",
    version: 1,
    content: [{ type: "extension", attrs: { extensionKey: "toc" } }],
  };

  const markdown = adfToMarkdown(adf);

  assert.ok(
    markdown.startsWith("```json\n"),
    "should render as a fenced json code block"
  );
  assert.ok(markdown.endsWith("\n```"), "should close the fence");
  assert.ok(
    !markdown.includes("adf:unknown"),
    "should not leave the raw adf:unknown comment wrapper"
  );

  // And it should be stable: parsing it back and re-rendering gives the same code block.
  assert.equal(adfToMarkdown(markdownToAdf(markdown)), markdown);
});

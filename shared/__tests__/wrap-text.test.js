import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { wrapText } from "../wrap-text.js";

describe("wrapText", () => {
  const options = { firstLine: "  --id    ", indent: "          ", width: 20 };

  test("wraps words under the indent, and starts each paragraph on a new line", () => {
    assert.equal(
      wrapText(["one two three", "four"], options),
      ["  --id    one two", "          three", "          four"].join("\n")
    );
  });

  test("gives a word longer than the width a line of its own", () => {
    assert.equal(
      wrapText(["a much-longer-than-the-width b"], options),
      [
        "  --id    a",
        "          much-longer-than-the-width",
        "          b",
      ].join("\n")
    );
  });

  test("separates the first word from a first line longer than the indent", () => {
    assert.equal(
      wrapText(["word"], { ...options, firstLine: "  --file-name" }),
      "  --file-name word"
    );
  });
});

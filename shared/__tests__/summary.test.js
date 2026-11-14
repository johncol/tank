import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildSummary } from "../summary.js";

describe("buildSummary", () => {
  test("counts results and is ok only when nothing failed", () => {
    const summary = buildSummary([
      { status: "success" },
      { status: "skipped" },
      { status: "failed" },
    ]);

    assert.deepEqual(
      { ...summary, results: undefined },
      {
        ok: false,
        total: 3,
        succeeded: 1,
        skipped: 1,
        failed: 1,
        results: undefined,
      }
    );
  });

  test("is not ok when the run stopped with an error", () => {
    const summary = buildSummary([], "Pass exactly one action flag.");

    assert.equal(summary.ok, false);
    assert.equal(summary.error, "Pass exactly one action flag.");
  });
});

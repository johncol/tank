import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveTestFolder,
  NO_SUITE_FOLDER,
  MULTIPLE_SUITES_FOLDER,
} from "../synthetic-test.js";

const TRACKED_SUITE_ENTRY = {
  path: "synced/synthetics/custom-folder/_suite.json",
  kind: "synthetic-suite",
  id: "aaa-111",
};

test("resolveTestFolder", async (t) => {
  await t.test("uses _no-suite for a test in no suite", () => {
    assert.equal(resolveTestFolder([TRACKED_SUITE_ENTRY], []), NO_SUITE_FOLDER);
  });

  await t.test(
    "uses _multiple-suites for a test in more than one suite",
    () => {
      const parentSuites = [
        { public_id: "aaa-111", name: "Suite A" },
        { public_id: "bbb-222", name: "Suite B" },
      ];

      assert.equal(
        resolveTestFolder([TRACKED_SUITE_ENTRY], parentSuites),
        MULTIPLE_SUITES_FOLDER
      );
    }
  );

  await t.test("uses a tracked suite's folder, wherever it lives", () => {
    const parentSuites = [{ public_id: "aaa-111", name: "Suite A" }];

    assert.equal(
      resolveTestFolder([TRACKED_SUITE_ENTRY], parentSuites),
      "synced/synthetics/custom-folder"
    );
  });

  await t.test(
    "uses the folder an untracked suite would be fetched into",
    () => {
      const parentSuites = [
        { public_id: "ccc-333", name: "S: Latency test suite in homepage" },
      ];

      assert.equal(
        resolveTestFolder([TRACKED_SUITE_ENTRY], parentSuites),
        "synced/synthetics/s-latency-test-suite-in-homepage"
      );
    }
  );
});

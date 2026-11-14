import test from "node:test";
import assert from "node:assert/strict";
import { omitFields } from "../json.js";

// Tracked files' content hashes depend on nested fields that share a name
// with a top-level read-only field (e.g. a suite's tests[].public_id) being
// kept.
test("omitFields only removes top-level fields", () => {
  const suite = { public_id: "abc", tests: [{ public_id: "def" }] };

  assert.deepEqual(omitFields(suite, ["public_id"]), {
    tests: [{ public_id: "def" }],
  });
});

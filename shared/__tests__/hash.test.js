import test from "node:test";
import assert from "node:assert/strict";
import { hashContent } from "../hash.js";

test("hashContent returns a sha256-prefixed hex digest", () => {
  const hash = hashContent("hello world");

  assert.match(hash, /^sha256:[0-9a-f]{64}$/);
});

test("hashContent is deterministic for the same content", () => {
  assert.equal(hashContent("same content"), hashContent("same content"));
});

test("hashContent differs for different content", () => {
  assert.notEqual(hashContent("content a"), hashContent("content b"));
});

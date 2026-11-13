import test from "node:test";
import assert from "node:assert/strict";
import { getErrorMessage, getErrorStatus } from "../error.js";

test("getErrorMessage returns the message of an Error instance", () => {
  assert.equal(getErrorMessage(new Error("boom")), "boom");
});

test("getErrorMessage stringifies non-Error values", () => {
  assert.equal(getErrorMessage("plain string"), "plain string");
  assert.equal(getErrorMessage(404), "404");
});

test("getErrorStatus returns a numeric status property when present", () => {
  const error = Object.assign(new Error("failed"), { status: 409 });

  assert.equal(getErrorStatus(error), 409);
});

test("getErrorStatus returns undefined when there is no status property", () => {
  assert.equal(getErrorStatus(new Error("failed")), undefined);
});

test("getErrorStatus returns undefined for non-object values", () => {
  assert.equal(getErrorStatus("plain string"), undefined);
  assert.equal(getErrorStatus(null), undefined);
});

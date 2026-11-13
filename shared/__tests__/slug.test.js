import test from "node:test";
import assert from "node:assert/strict";
import { slugify, parseKebabCaseName } from "../slug.js";

test("slugify lowercases and hyphenates a normal title", () => {
  assert.equal(slugify("Decisions Log"), "decisions-log");
});

test("slugify collapses punctuation and repeated separators", () => {
  assert.equal(
    slugify("Datadog Artifacts: Dashboards & Metrics!!"),
    "datadog-artifacts-dashboards-metrics"
  );
});

test("slugify trims leading and trailing separators", () => {
  assert.equal(slugify("  -- Edge Cases -- "), "edge-cases");
});

test("parseKebabCaseName accepts a plain kebab-case name", () => {
  assert.equal(parseKebabCaseName("decisions-log", ".md"), "decisions-log");
});

test("parseKebabCaseName accepts the same name with its extension", () => {
  assert.equal(parseKebabCaseName("decisions-log.md", ".md"), "decisions-log");
});

test("parseKebabCaseName works with a different extension (not hardcoded to .md)", () => {
  assert.equal(
    parseKebabCaseName("dynamic-rendering.json", ".json"),
    "dynamic-rendering"
  );
  assert.equal(
    parseKebabCaseName("dynamic-rendering", ".json"),
    "dynamic-rendering"
  );
});

test("parseKebabCaseName accepts digits", () => {
  assert.equal(parseKebabCaseName("doc-2026", ".md"), "doc-2026");
});

test("parseKebabCaseName rejects uppercase letters", () => {
  assert.equal(parseKebabCaseName("Decisions-Log", ".md"), null);
});

test("parseKebabCaseName rejects underscores and spaces", () => {
  assert.equal(parseKebabCaseName("decisions_log", ".md"), null);
  assert.equal(parseKebabCaseName("decisions log", ".md"), null);
});

test("parseKebabCaseName rejects leading, trailing, and doubled hyphens", () => {
  assert.equal(parseKebabCaseName("-decisions-log", ".md"), null);
  assert.equal(parseKebabCaseName("decisions-log-", ".md"), null);
  assert.equal(parseKebabCaseName("decisions--log", ".md"), null);
});

test("parseKebabCaseName rejects an empty name, with or without its extension", () => {
  assert.equal(parseKebabCaseName("", ".md"), null);
  assert.equal(parseKebabCaseName(".md", ".md"), null);
});

test("parseKebabCaseName rejects an extension other than the expected one", () => {
  assert.equal(parseKebabCaseName("decisions-log.txt", ".md"), null);
});

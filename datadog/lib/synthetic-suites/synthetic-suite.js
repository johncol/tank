import { slugify } from "../../../shared/slug.js";

/** Root folder for synthetic suites and tests. Each suite gets its own
 * folder, holding the suite definition and the tests that belong to it. */
export const SYNTHETICS_PATH = "synced/synthetics";

/** The suite definition's file name inside its folder. The leading
 * underscore sorts it first and keeps it from clashing with a test file,
 * since slugified test names never start with one. */
export const SUITE_FILE_NAME = "_suite.json";

/**
 * Fields Datadog's suite API returns but doesn't accept back on update --
 * metadata about the suite's identity, history, and live state, not its
 * definition. The ones worth keeping are tracked in sync-manifest.yaml.
 */
const READ_ONLY_FIELDS = [
  "public_id",
  "created_at",
  "created_by",
  "modified_at",
  "modified_by",
  "monitor_id",
  "org_id",
  "version",
  "version_uuid",
  "overall_state",
  "overall_state_modified",
];

/** Strips Datadog's read-only suite metadata, leaving only the fields that
 * make up the suite's write payload (name, tests, options, etc.). */
export function stripReadOnlySuiteFields(suite) {
  const cloned = { ...suite };

  for (const field of READ_ONLY_FIELDS) {
    delete cloned[field];
  }

  return cloned;
}

/** Serializes a suite definition as pretty-printed JSON. */
export function formatSuiteJson(suite) {
  return `${JSON.stringify(suite, null, 2)}\n`;
}

/** Builds the folder for a suite from its name, e.g. "S: Latency test suite
 * in homepage" -> "synced/synthetics/s-latency-test-suite-in-homepage". */
export function buildSuiteFolder(suiteName) {
  return `${SYNTHETICS_PATH}/${slugify(suiteName)}`;
}

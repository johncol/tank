import path from "node:path";
import { findEntryById } from "../../../shared/manifest.js";
import {
  SYNTHETICS_PATH,
  buildSuitePath,
} from "../synthetic-suites/synthetic-suite.js";

/** Folder for tests that don't belong to any suite. Slugified suite names
 * never start with an underscore, so it can't clash with a suite folder. */
export const NO_SUITE_FOLDER = `${SYNTHETICS_PATH}/_no-suite`;

/** Folder for tests that belong to more than one suite, since no single
 * suite folder can hold them. */
export const MULTIPLE_SUITES_FOLDER = `${SYNTHETICS_PATH}/_multiple-suites`;

/**
 * Fields Datadog's synthetic test API returns but doesn't accept back on
 * update -- metadata about the test's identity and history, not its
 * definition. The ones worth keeping are tracked in sync-manifest.yaml.
 */
const READ_ONLY_FIELDS = [
  "public_id",
  "created_at",
  "modified_at",
  "creator",
  "monitor_id",
];

/** Strips Datadog's read-only test metadata, leaving only the fields that
 * make up the test's write payload (name, config, locations, etc.). */
export function stripReadOnlyTestFields(test) {
  const cloned = { ...test };

  for (const field of READ_ONLY_FIELDS) {
    delete cloned[field];
  }

  return cloned;
}

/** Lists the read-only fields a test definition has, e.g. when it was
 * copied from another test's API response. */
export function findReadOnlyTestFields(test) {
  return READ_ONLY_FIELDS.filter((field) => field in test);
}

/** Serializes a test definition as pretty-printed JSON. */
export function formatTestJson(test) {
  return `${JSON.stringify(test, null, 2)}\n`;
}

/**
 * Decides which folder a test belongs in, from the suites Datadog says it
 * belongs to:
 * - no suite: NO_SUITE_FOLDER.
 * - more than one suite: MULTIPLE_SUITES_FOLDER.
 * - exactly one suite: that suite's folder. If the suite is tracked, that's
 *   wherever its manifest entry lives; otherwise, the folder it would be
 *   fetched into.
 */
export function resolveTestFolder(entries, parentSuites) {
  if (parentSuites.length === 0) {
    return NO_SUITE_FOLDER;
  }

  if (parentSuites.length > 1) {
    return MULTIPLE_SUITES_FOLDER;
  }

  const [parentSuite] = parentSuites;
  const suiteEntry = findEntryById(
    entries,
    "synthetic-suite",
    parentSuite.public_id
  );

  if (suiteEntry) {
    return path.posix.dirname(suiteEntry.path);
  }

  const suitePath = buildSuitePath(
    parentSuite.name,
    parentSuite.public_id,
    (artifactPath) => entries.some((entry) => entry.path === artifactPath)
  );

  return path.posix.dirname(suitePath);
}

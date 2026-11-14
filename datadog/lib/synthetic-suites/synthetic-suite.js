import { buildTitledPath } from "../../../shared/slug.js";

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
export const READ_ONLY_SUITE_FIELDS = [
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

/** Builds the path a suite is fetched into, in a folder named from its
 * name, e.g. "S: Latency test suite in homepage" ->
 * "synced/synthetics/s-latency-test-suite-in-homepage/_suite.json". The
 * folder also gets the suite's ID when the name has no slug or its path is
 * taken (see buildTitledPath). */
export function buildSuitePath(suiteName, suiteId, isPathTaken) {
  return buildTitledPath({
    title: suiteName,
    id: suiteId,
    buildPath: (name) => `${SYNTHETICS_PATH}/${name}/${SUITE_FILE_NAME}`,
    isPathTaken,
  });
}

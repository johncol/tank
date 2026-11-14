import path from "node:path";
import { DATADOG_DIR, isPathTracked } from "../manifest.js";
import {
  stripReadOnlySuiteFields,
  formatSuiteJson,
  buildSuitePath,
} from "./synthetic-suite.js";
import { fetchUntrackedMemberTests } from "./fetch-member-tests.js";

/**
 * Plugs Datadog synthetic suites into the shared action engine
 * (shared/actions.js). Each suite is a `_suite.json` in a folder named from
 * the suite name, which also holds the suite's tests.
 *
 * Fetching or pulling a suite also fetches its untracked tests into that
 * folder. Pushing a suite's `tests` list doesn't move test files locally:
 * pull the affected tests afterwards, and they move to their new folder.
 *
 * @type {import("../../../shared/actions.js").Adapter}
 */
export const syntheticSuiteAdapter = {
  kind: "synthetic-suite",
  label: "Datadog synthetic suite",
  systemName: "Datadog",
  actions: ["fetch", "pull", "push", "delete"],
  rootDir: DATADOG_DIR,
  allowsFileName: false,

  // --name is the suite's folder name, with or without a trailing slash (as
  // shell tab-completion adds it).
  findEntriesByName(entries, name) {
    const folderName = name.replace(/\/$/, "");

    return entries.filter(
      (entry) =>
        path.posix.basename(path.posix.dirname(entry.path)) === folderName
    );
  },

  async getRemote(client, id) {
    return client.getSyntheticSuite(id);
  },

  describeRemote(suite) {
    return {
      title: suite.name,
      remoteVersion: suite.modified_at,
      content: formatSuiteJson(stripReadOnlySuiteFields(suite)),
    };
  },

  buildFetchPath({ document, id, remote }) {
    return buildSuitePath(remote.name, id, (artifactPath) =>
      isPathTracked(document, artifactPath)
    );
  },

  async updateRemote(client, entry, content) {
    return client.updateSyntheticSuite(entry.id, JSON.parse(content));
  },

  async deleteRemote(client, id) {
    await client.deleteSyntheticSuite(id);
  },

  // `this` is the adapter the engine runs, so the tests land in the same
  // rootDir as the suite.
  async afterFetch(client, document, suite) {
    return fetchUntrackedMemberTests(client, document, suite, this.rootDir);
  },

  async afterPull(client, document, suite) {
    return fetchUntrackedMemberTests(client, document, suite, this.rootDir);
  },

  deleteFollowUpMessage() {
    return "The suite's tests weren't deleted. Run --synthetic-tests --pull to move them out of its folder.";
  },
};

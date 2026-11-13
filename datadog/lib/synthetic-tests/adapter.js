import path from "node:path";
import { DATADOG_DIR, listManifestEntries } from "../manifest.js";
import {
  stripReadOnlyTestFields,
  findReadOnlyTestFields,
  formatTestJson,
  resolveTestFolder,
  NO_SUITE_FOLDER,
} from "./synthetic-test.js";
import { stripReadOnlySuiteFields } from "../synthetic-suites/synthetic-suite.js";
import { slugify } from "../../../shared/slug.js";

async function findTestFolder(client, document, testId) {
  const parentSuites = await client.getSyntheticTestParentSuites(testId);

  return resolveTestFolder(listManifestEntries(document), parentSuites);
}

/**
 * Plugs Datadog synthetic tests into the shared action engine
 * (shared/actions.js). Files are named from the test name, inside the
 * folder of the suite the test belongs to (see resolveTestFolder).
 *
 * Suite membership isn't part of a test, so pushing a test never moves it
 * between suites: edit the suite's `tests` instead. Pulling a test moves its
 * file (keeping its file name) when its membership changed in Datadog.
 *
 * Like dashboards, the synthetic test API has no server-side optimistic
 * concurrency, so the engine's `modified_at` check is purely client-side.
 *
 * Datadog assigns a new test's ID, so --create takes a file name, and
 * --suite adds the new test to a tracked suite (as a critical test) in the
 * same run. --delete removes the test from its suites first, since Datadog
 * refuses to delete a test that's still in one.
 *
 * @type {import("../../../shared/actions.js").Adapter}
 */
export const syntheticTestAdapter = {
  kind: "synthetic-test",
  label: "Datadog synthetic test",
  systemName: "Datadog",
  actions: ["fetch", "pull", "push", "create", "delete"],
  rootDir: DATADOG_DIR,
  allowsFileName: false,
  fileNameSuffix: ".json",
  assignsIdOnCreate: true,

  async getRemote(client, id) {
    return client.getSyntheticTest(id);
  },

  describeRemote(test) {
    return {
      title: test.name,
      remoteVersion: test.modified_at,
      content: formatTestJson(stripReadOnlyTestFields(test)),
    };
  },

  async buildFetchPath({ client, document, id, remote }) {
    const folder = await findTestFolder(client, document, id);

    return `${folder}/${slugify(remote.name)}.json`;
  },

  async buildPullPath({ client, document, entry }) {
    const folder = await findTestFolder(client, document, entry.id);

    return `${folder}/${path.posix.basename(entry.path)}`;
  },

  async updateRemote(client, entry, content) {
    await client.updateSyntheticTest(entry.id, JSON.parse(content));

    // Datadog doesn't document modified_at as part of the edit response, so
    // read it back to record the exact value the next push compares against.
    return client.getSyntheticTest(entry.id);
  },

  buildCreatePath({ fileName, parentEntry }) {
    const folder = parentEntry
      ? path.posix.dirname(parentEntry.path)
      : NO_SUITE_FOLDER;

    return `${folder}/${fileName}.json`;
  },

  // Datadog doesn't enforce unique test names, so a same-named test is the
  // only way to catch a create that already ran (e.g. retried after a
  // timeout).
  async findRemoteIdByContent(client, content) {
    const { name } = JSON.parse(content);
    const sameNamedTest = (await client.listSyntheticTests()).find(
      (test) => test.name === name
    );

    return sameNamedTest?.public_id ?? null;
  },

  async createRemote(client, id, content) {
    const test = JSON.parse(content);
    const readOnlyFields = findReadOnlyTestFields(test);

    if (readOnlyFields.length > 0) {
      throw new Error(
        `Remove ${readOnlyFields.join(", ")} from the file: Datadog sets them.`
      );
    }

    const createdTest = await client.createSyntheticTest(test);

    // Read it back, as updateRemote does, for the exact modified_at.
    return client.getSyntheticTest(createdTest.public_id);
  },

  getCreatedId(test) {
    return test.public_id;
  },

  parent: {
    flag: "suite",
    kind: "synthetic-suite",

    async addChild(client, suiteId, liveSuite, testId) {
      const suite = stripReadOnlySuiteFields(liveSuite);

      await client.updateSyntheticSuite(suiteId, {
        ...suite,
        tests: [
          ...(suite.tests ?? []),
          { public_id: testId, alerting_criticality: "critical" },
        ],
      });

      return client.getSyntheticSuite(suiteId);
    },

    async removeChild(client, suiteId, liveSuite, testId) {
      const suite = stripReadOnlySuiteFields(liveSuite);

      await client.updateSyntheticSuite(suiteId, {
        ...suite,
        tests: (suite.tests ?? []).filter((test) => test.public_id !== testId),
      });

      return client.getSyntheticSuite(suiteId);
    },

    // Datadog refuses to delete a test that's still in a suite.
    async listParentIds(client, testId) {
      const parentSuites = await client.getSyntheticTestParentSuites(testId);

      return parentSuites.map((parentSuite) => parentSuite.public_id);
    },
  },

  async deleteRemote(client, id) {
    await client.deleteSyntheticTest(id);
  },
};

import { syntheticSuiteAdapter } from "../adapter.js";
import { formatSuiteJson } from "../synthetic-suite.js";

/**
 * Runs synthetic suites through the action contract tests
 * (shared/__tests__/action-contract.test.js) against an in-memory Datadog.
 * Suites have no tests here, so fetch and pull have no follow-up results;
 * adapter.test.js covers those.
 *
 * @type {import("../../../../shared/__tests__/action-contract.test.js").ContractFixture}
 */
export const syntheticSuiteContractFixture = {
  adapter: syntheticSuiteAdapter,
  sampleIds: ["sss-aaa-001", "sss-aaa-002"],

  createFakeRemote() {
    const suites = new Map();
    let clock = 0;

    function nextModifiedAt() {
      clock += 1;
      return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
    }

    function getExisting(id) {
      if (!suites.has(id)) {
        throw Object.assign(
          new Error(`Datadog API GET /synthetics/suites/${id} failed with 404`),
          { status: 404 }
        );
      }

      return suites.get(id);
    }

    return {
      client: {
        async getSyntheticSuite(id) {
          return structuredClone(getExisting(id));
        },
        async updateSyntheticSuite(id, suite) {
          const existing = getExisting(id);
          const updated = {
            ...suite,
            public_id: id,
            created_by: existing.created_by,
            modified_at: nextModifiedAt(),
          };

          suites.set(id, updated);
          return structuredClone(updated);
        },
        async deleteSyntheticSuite(id) {
          getExisting(id);
          suites.delete(id);
        },
      },
      addRemote(id) {
        suites.set(id, {
          public_id: id,
          name: `Contract Suite ${id}`,
          tests: [],
          created_by: { email: "someone@example.com" },
          modified_at: nextModifiedAt(),
        });
      },
      changeRemote(id) {
        const existing = getExisting(id);

        suites.set(id, {
          ...existing,
          message: `Changed in Datadog at ${clock}`,
          modified_at: nextModifiedAt(),
        });
      },
      touchRemote(id) {
        suites.set(id, { ...getExisting(id), modified_at: nextModifiedAt() });
      },
      removeRemote(id) {
        suites.delete(id);
      },
      /** Lists the suites that include the test, as Datadog's parent-suites
       * endpoint does. */
      listParentSuites(testId) {
        return [...suites.values()]
          .filter((suite) =>
            suite.tests.some((test) => test.public_id === testId)
          )
          .map(({ public_id, name }) => ({ public_id, name }));
      },
    };
  },

  editLocalContent(content) {
    return formatSuiteJson({
      ...JSON.parse(content),
      message: "Edited locally",
    });
  },
};

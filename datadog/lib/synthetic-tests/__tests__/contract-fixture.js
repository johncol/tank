import { syntheticTestAdapter } from "../adapter.js";
import { formatTestJson } from "../synthetic-test.js";
import { syntheticSuiteAdapter } from "../../synthetic-suites/adapter.js";
import { syntheticSuiteContractFixture } from "../../synthetic-suites/__tests__/contract-fixture.js";

/**
 * Runs synthetic tests through the action contract tests
 * (shared/__tests__/action-contract.test.js) against an in-memory Datadog.
 * Tests fetched here belong to no suite, so they land in the _no-suite
 * folder. Suites (from the suite fixture) are the parent --create adds to,
 * and --delete removes from. Like Datadog, deleting a test still in a suite
 * fails.
 *
 * @type {import("../../../../shared/__tests__/action-contract.test.js").ContractFixture}
 */
export const syntheticTestContractFixture = {
  adapter: syntheticTestAdapter,
  sampleIds: ["ttt-aaa-001", "ttt-aaa-002"],
  parentAdapter: syntheticSuiteAdapter,
  parentSampleId: "sss-aaa-001",

  createFakeRemote() {
    const tests = new Map();
    const suiteFake = syntheticSuiteContractFixture.createFakeRemote();
    let clock = 0;
    let createdCount = 0;
    let failNextSuiteUpdate = false;

    function nextModifiedAt() {
      clock += 1;
      return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
    }

    function getExisting(id) {
      if (!tests.has(id)) {
        throw Object.assign(
          new Error(`Datadog API GET /synthetics/tests/${id} failed with 404`),
          { status: 404 }
        );
      }

      return tests.get(id);
    }

    return {
      client: {
        async getSyntheticTest(id) {
          return structuredClone(getExisting(id));
        },
        async getSyntheticTestParentSuites(id) {
          getExisting(id);
          return suiteFake.listParentSuites(id);
        },
        // Like Datadog, the edit response leaves out modified_at.
        async updateSyntheticTest(id, test) {
          const existing = getExisting(id);
          const updated = {
            ...test,
            public_id: id,
            creator: existing.creator,
            modified_at: nextModifiedAt(),
          };

          tests.set(id, updated);
          const response = structuredClone(updated);
          delete response.modified_at;
          return response;
        },
        async deleteSyntheticTest(id) {
          getExisting(id);

          if (suiteFake.listParentSuites(id).length > 0) {
            throw Object.assign(
              new Error(
                "Datadog API POST /synthetics/tests/delete failed with 400: part of a test suite"
              ),
              { status: 400 }
            );
          }

          tests.delete(id);
        },
        async listSyntheticTests() {
          return [...tests.values()].map(({ public_id, name, type }) => ({
            public_id,
            name,
            type,
          }));
        },
        async createSyntheticTest(test) {
          createdCount += 1;
          const id = `ttt-new-${String(createdCount).padStart(3, "0")}`;
          const created = {
            ...test,
            public_id: id,
            creator: { email: "someone@example.com" },
            modified_at: nextModifiedAt(),
          };

          tests.set(id, created);
          return structuredClone(created);
        },
        getSyntheticSuite: suiteFake.client.getSyntheticSuite,
        async updateSyntheticSuite(id, suite) {
          if (failNextSuiteUpdate) {
            failNextSuiteUpdate = false;
            throw new Error(
              `Datadog API PUT /synthetics/suites/${id} failed with 500`
            );
          }

          return suiteFake.client.updateSyntheticSuite(id, suite);
        },
      },
      parent: {
        addRemote: suiteFake.addRemote,
        changeRemote: suiteFake.changeRemote,
        failNextUpdate() {
          failNextSuiteUpdate = true;
        },
      },
      addRemote(id) {
        tests.set(id, {
          public_id: id,
          name: `Contract Test ${id}`,
          type: "api",
          creator: { email: "someone@example.com" },
          locations: ["aws:us-east-1"],
          modified_at: nextModifiedAt(),
        });
      },
      changeRemote(id) {
        const existing = getExisting(id);

        tests.set(id, {
          ...existing,
          message: `Changed in Datadog at ${clock}`,
          modified_at: nextModifiedAt(),
        });
      },
      touchRemote(id) {
        tests.set(id, { ...getExisting(id), modified_at: nextModifiedAt() });
      },
      renameRemote(id, name) {
        tests.set(id, { ...getExisting(id), name });
      },
      removeRemote(id) {
        tests.delete(id);
      },
    };
  },

  editLocalContent(content) {
    return formatTestJson({
      ...JSON.parse(content),
      message: "Edited locally",
    });
  },

  // Named like addRemote names the remote with the same key.
  buildNewLocalContent(key) {
    return formatTestJson({
      name: `Contract Test ${key}`,
      type: "api",
      locations: ["aws:us-east-1"],
    });
  },
};

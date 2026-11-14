import { dashboardAdapter } from "../adapter.js";
import { formatJson } from "../../../../shared/json.js";

/**
 * Runs dashboards through the action contract tests
 * (shared/__tests__/action-contract.test.js) against an in-memory Datadog.
 *
 * @type {import("../../../../shared/__tests__/action-contract.test.js").ContractFixture}
 */
export const dashboardContractFixture = {
  adapter: dashboardAdapter,
  sampleIds: ["abc-def-001", "abc-def-002"],

  createFakeRemote() {
    const dashboards = new Map();
    let clock = 0;
    let nextCreatedNumber = 900;

    function nextModifiedAt() {
      clock += 1;
      return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
    }

    function getExisting(id) {
      if (!dashboards.has(id)) {
        throw Object.assign(
          new Error(`Datadog API GET /dashboard/${id} failed with 404`),
          { status: 404 }
        );
      }

      return dashboards.get(id);
    }

    return {
      client: {
        async getDashboard(id) {
          return structuredClone(getExisting(id));
        },
        async updateDashboard(id, dashboard) {
          const existing = getExisting(id);
          const updated = {
            ...dashboard,
            id,
            author_handle: existing.author_handle,
            modified_at: nextModifiedAt(),
          };

          dashboards.set(id, updated);
          return structuredClone(updated);
        },
        async listDashboards() {
          return [...dashboards.values()].map(({ id, title }) => ({
            id,
            title,
          }));
        },
        async createDashboard(dashboard) {
          const id = `new-dsh-${nextCreatedNumber}`;
          nextCreatedNumber += 1;
          const created = {
            ...dashboard,
            id,
            author_handle: "someone@example.com",
            modified_at: nextModifiedAt(),
          };

          dashboards.set(id, created);
          return structuredClone(created);
        },
        async deleteDashboard(id) {
          getExisting(id);
          dashboards.delete(id);
        },
      },
      addRemote(id) {
        dashboards.set(id, {
          id,
          title: `Contract Dashboard ${id}`,
          author_handle: "someone@example.com",
          widgets: [],
          layout_type: "ordered",
          modified_at: nextModifiedAt(),
        });
      },
      changeRemote(id) {
        const existing = getExisting(id);

        dashboards.set(id, {
          ...existing,
          description: `Changed in Datadog at ${clock}`,
          modified_at: nextModifiedAt(),
        });
      },
      touchRemote(id) {
        dashboards.set(id, {
          ...getExisting(id),
          modified_at: nextModifiedAt(),
        });
      },
      renameRemote(id, title) {
        dashboards.set(id, { ...getExisting(id), title });
      },
      removeRemote(id) {
        dashboards.delete(id);
      },
    };
  },

  editLocalContent(content) {
    return formatJson({
      ...JSON.parse(content),
      description: "Edited locally",
    });
  },

  // Titled like addRemote titles the remote with the same key.
  buildNewLocalContent(key) {
    return formatJson({
      title: `Contract Dashboard ${key}`,
      widgets: [],
      layout_type: "ordered",
    });
  },
};

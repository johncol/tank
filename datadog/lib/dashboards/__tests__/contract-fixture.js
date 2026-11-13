import { dashboardAdapter } from "../adapter.js";
import { formatDashboardJson } from "../dashboard.js";

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
      removeRemote(id) {
        dashboards.delete(id);
      },
    };
  },

  editLocalContent(content) {
    return formatDashboardJson({
      ...JSON.parse(content),
      description: "Edited locally",
    });
  },
};

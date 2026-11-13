import { logMetricAdapter } from "../adapter.js";
import { formatLogMetricJson } from "../log-metric.js";

/**
 * Runs log-based metrics through the action contract tests
 * (shared/__tests__/action-contract.test.js) against an in-memory Datadog.
 *
 * @type {import("../../../../shared/__tests__/action-contract.test.js").ContractFixture}
 */
export const logMetricContractFixture = {
  adapter: logMetricAdapter,
  sampleIds: ["contract.metric.one", "contract.metric.two"],

  createFakeRemote() {
    const metrics = new Map();
    let changeCount = 0;

    function buildNotFoundError(id) {
      return Object.assign(
        new Error(`Datadog API GET /logs/config/metrics/${id} failed with 404`),
        { status: 404 }
      );
    }

    function getExisting(id) {
      if (!metrics.has(id)) {
        throw buildNotFoundError(id);
      }

      return metrics.get(id);
    }

    return {
      client: {
        async getLogMetric(id) {
          return structuredClone(getExisting(id));
        },
        async updateLogMetric(id, { filter, group_by }) {
          const existing = getExisting(id);
          const updated = {
            ...existing,
            attributes: { ...existing.attributes, filter, group_by },
          };

          metrics.set(id, updated);
          return structuredClone(updated);
        },
        async createLogMetric(id, { filter, group_by, compute }) {
          if (metrics.has(id)) {
            throw Object.assign(
              new Error(
                "Datadog API POST /logs/config/metrics failed with 409"
              ),
              { status: 409 }
            );
          }

          // Datadog fills in compute defaults on create.
          const created = {
            id,
            type: "logs_metrics",
            attributes: {
              filter,
              group_by,
              compute: { ...compute, include_percentiles: false },
            },
          };

          metrics.set(id, created);
          return structuredClone(created);
        },
        async deleteLogMetric(id) {
          getExisting(id);
          metrics.delete(id);
        },
      },
      addRemote(id) {
        metrics.set(id, {
          id,
          type: "logs_metrics",
          attributes: {
            filter: { query: "service:contract" },
            group_by: [],
            compute: { aggregation_type: "count" },
          },
        });
      },
      changeRemote(id) {
        const existing = getExisting(id);
        changeCount += 1;

        metrics.set(id, {
          ...existing,
          attributes: {
            ...existing.attributes,
            filter: { query: `service:changed-${changeCount}` },
          },
        });
      },
      removeRemote(id) {
        metrics.delete(id);
      },
    };
  },

  editLocalContent(content) {
    return formatLogMetricJson({
      ...JSON.parse(content),
      filter: { query: "service:edited-locally" },
    });
  },

  buildNewLocalContent() {
    return formatLogMetricJson({
      filter: { query: "service:new" },
      compute: { aggregation_type: "count" },
    });
  },
};

import { monitorAdapter } from "../adapter.js";
import { formatJson } from "../../../../shared/json.js";

/**
 * Runs monitors through the action contract tests
 * (shared/__tests__/action-contract.test.js) against an in-memory Datadog.
 * Like Datadog, monitor IDs are numbers, and the create and update responses
 * have other fields than a read (no `creator`, an extra
 * `restriction_policy`).
 *
 * @type {import("../../../../shared/__tests__/action-contract.test.js").ContractFixture}
 */
export const monitorContractFixture = {
  adapter: monitorAdapter,
  sampleIds: ["1001", "1002"],

  createFakeRemote() {
    const monitors = new Map();
    let clock = 0;
    let nextCreatedId = 9001;

    function nextModified() {
      clock += 1;
      return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
    }

    function getExisting(id) {
      if (!monitors.has(String(id))) {
        throw Object.assign(
          new Error(`Datadog API GET /monitor/${id} failed with 404`),
          { status: 404 }
        );
      }

      return monitors.get(String(id));
    }

    function buildWriteResponse(monitor) {
      const response = { ...structuredClone(monitor), restriction_policy: {} };
      delete response.creator;
      return response;
    }

    function buildMonitor(id, name) {
      return {
        id: Number(id),
        name,
        type: "metric alert",
        query: "avg(last_5m):avg:system.cpu.user{*} > 90",
        message: "CPU is high",
        options: { thresholds: { critical: 90 } },
        creator: { email: "someone@example.com" },
        overall_state: "OK",
        modified: nextModified(),
      };
    }

    return {
      client: {
        async getMonitor(id) {
          return structuredClone(getExisting(id));
        },
        async updateMonitor(id, monitor) {
          const existing = getExisting(id);
          const updated = {
            ...monitor,
            id: existing.id,
            creator: existing.creator,
            overall_state: existing.overall_state,
            modified: nextModified(),
          };

          monitors.set(String(id), updated);
          return buildWriteResponse(updated);
        },
        // Like Datadog, matches part of the name, ignoring case.
        async listMonitorsByName(name) {
          return [...monitors.values()]
            .filter((monitor) =>
              monitor.name.toLowerCase().includes(name.toLowerCase())
            )
            .map((monitor) => structuredClone(monitor));
        },
        async createMonitor(monitor) {
          const id = nextCreatedId;
          nextCreatedId += 1;
          const created = {
            ...monitor,
            id,
            creator: { email: "someone@example.com" },
            overall_state: "No Data",
            modified: nextModified(),
          };

          monitors.set(String(id), created);
          return buildWriteResponse(created);
        },
        async deleteMonitor(id) {
          getExisting(id);
          monitors.delete(String(id));
        },
      },
      addRemote(id) {
        monitors.set(id, buildMonitor(id, `Contract Monitor ${id}`));
      },
      changeRemote(id) {
        monitors.set(id, {
          ...getExisting(id),
          message: `Changed in Datadog at ${clock}`,
          modified: nextModified(),
        });
      },
      touchRemote(id) {
        monitors.set(id, { ...getExisting(id), modified: nextModified() });
      },
      renameRemote(id, name) {
        monitors.set(id, { ...getExisting(id), name });
      },
      removeRemote(id) {
        monitors.delete(id);
      },
    };
  },

  editLocalContent(content) {
    return formatJson({
      ...JSON.parse(content),
      message: "Edited locally",
    });
  },

  // Named like addRemote names the remote with the same key.
  buildNewLocalContent(key) {
    return formatJson({
      name: `Contract Monitor ${key}`,
      type: "metric alert",
      query: "avg(last_5m):avg:system.cpu.user{*} > 90",
      message: "CPU is high",
      options: { thresholds: { critical: 90 } },
    });
  },
};

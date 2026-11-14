import { DATADOG_DIR } from "../manifest.js";
import {
  formatLogMetricJson,
  hashLogMetric,
  hasComputeChanged,
} from "./log-metric.js";

const LOG_METRICS_PATH = "synced/log-metrics";

function buildLogMetricPath(metricId) {
  return `${LOG_METRICS_PATH}/${metricId}.json`;
}

/**
 * Plugs Datadog log-based metrics into the shared action engine
 * (shared/actions.js). Files are named after the metric ID, and hold the
 * metric's `attributes` (filter, group_by, compute).
 *
 * Datadog's log-based metrics API has no modified_at or version field, so
 * `remoteVersion` is a hash of the live definition (see hashLogMetric).
 *
 * @type {import("../../../shared/actions.js").Adapter}
 */
export const logMetricAdapter = {
  kind: "log-metric",
  label: "Datadog log-based metric",
  systemName: "Datadog",
  actions: ["fetch", "pull", "push", "create", "delete"],
  rootDir: DATADOG_DIR,
  allowsFileName: false,
  usageNote: "Its ID is the metric name.",

  async getRemote(client, id) {
    return client.getLogMetric(id);
  },

  describeRemote(metric) {
    return {
      title: metric.id,
      remoteVersion: hashLogMetric(metric),
      content: formatLogMetricJson(metric.attributes),
    };
  },

  buildFetchPath({ id }) {
    return buildLogMetricPath(id);
  },

  // Datadog fixes `compute` at creation, so only filter and group_by are sent.
  async updateRemote(client, entry, content) {
    const localAttributes = JSON.parse(content);

    return client.updateLogMetric(entry.id, {
      filter: localAttributes.filter,
      group_by: localAttributes.group_by ?? [],
    });
  },

  buildCreatePath({ id }) {
    return buildLogMetricPath(id);
  },

  async createRemote(client, id, content) {
    const localAttributes = JSON.parse(content);

    return client.createLogMetric(id, {
      filter: localAttributes.filter,
      group_by: localAttributes.group_by ?? [],
      compute: localAttributes.compute,
    });
  },

  async deleteRemote(client, id) {
    await client.deleteLogMetric(id);
  },

  pushChecks: [
    {
      // Datadog would reject the update anyway, so --force can't skip this.
      forceable: false,
      check({ content, liveRemote }) {
        if (hasComputeChanged(JSON.parse(content), liveRemote.attributes)) {
          return "`compute` can't be changed on an existing log-based metric; Datadog fixes it at creation. Revert the local change to `compute`.";
        }

        return null;
      },
    },
  ],
};

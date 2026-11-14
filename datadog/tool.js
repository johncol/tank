import { DatadogClient } from "./lib/datadog-client.js";
import { dashboardAdapter } from "./lib/dashboards/adapter.js";
import { logMetricAdapter } from "./lib/log-metrics/adapter.js";
import { syntheticTestAdapter } from "./lib/synthetic-tests/adapter.js";
import { syntheticSuiteAdapter } from "./lib/synthetic-suites/adapter.js";

/**
 * "tank datadog", registered in project/tools.js.
 * @type {import("../project/tools.js").Tool}
 */
export const datadogTool = {
  name: "datadog",
  serviceName: "Datadog",
  description:
    "Syncs Datadog dashboards, log-based metrics, and synthetic tests and suites.",
  examples: ["--dashboards --pull", "--log-metrics --fetch --id=<metricId>"],
  kinds: {
    dashboard: {
      flag: "dashboards",
      adapter: dashboardAdapter,
    },
    "log-metric": {
      flag: "log-metrics",
      adapter: logMetricAdapter,
    },
    "synthetic-test": {
      flag: "synthetic-tests",
      adapter: syntheticTestAdapter,
    },
    "synthetic-suite": {
      flag: "synthetic-suites",
      adapter: syntheticSuiteAdapter,
    },
  },
  manifestHeader: `# Source of truth for which datadog artifacts (dashboards, log-based
# metrics, and synthetic tests and suites) are synced with which Datadog
# objects. Read and written by tank ("tank datadog"), which also owns this
# header: "tank upgrade" rewrites it, and never touches the entries.
#
# Each entry is keyed by the local file's path and holds:
#   kind: "dashboard", "log-metric", "synthetic-test", or "synthetic-suite".
#   title: the dashboard title or test/suite name. Log metrics have no
#     title, so it repeats the metric ID.
#   id: the Datadog public ID, or the metric name for log metrics.
#   lastSyncedAt: when a sync last changed the file or Datadog.
#   remoteVersion: Datadog's modified_at at the last sync. Log metrics have
#     no modified_at, so it holds a hash of the metric definition instead.
#     A push compares the live value against it before overwriting (a purely
#     client-side check: Datadog has no optimistic concurrency).
#   contentHash: hash of the local file at the last sync.
`,
  // Everything Datadog needs is a credential (see DatadogClient).
  domainVariables: [],
  createClient: () => new DatadogClient(),
};

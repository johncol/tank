import { dashboardAdapter } from "./dashboards/adapter.js";
import { logMetricAdapter } from "./log-metrics/adapter.js";
import { syntheticTestAdapter } from "./synthetic-tests/adapter.js";
import { syntheticSuiteAdapter } from "./synthetic-suites/adapter.js";

/**
 * Per-kind operations, keyed by manifest `kind`. Every kind runs through
 * the shared action engine (shared/actions.js) and the shared CLI runner
 * (shared/cli.js): `flag` is its CLI kind flag, and its adapter's `actions`
 * lists what it supports.
 */
export const KINDS = {
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
};

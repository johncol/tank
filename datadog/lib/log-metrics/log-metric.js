import { hashContent } from "../../../shared/hash.js";

/** Serializes a log-based metric's definition (its `attributes`: filter,
 * group_by, compute) as pretty-printed JSON. The metric ID isn't included:
 * it's the file name and lives in the manifest. */
export function formatLogMetricJson(attributes) {
  return `${JSON.stringify(attributes, null, 2)}\n`;
}

/**
 * Hashes a log-based metric's definition as Datadog returns it. Datadog's
 * log-based metrics API has no modified_at or version field, so this hash,
 * recorded in the manifest as `remoteVersion` at each sync, is the only way to
 * tell whether the metric changed in Datadog since then.
 */
export function hashLogMetric(metric) {
  return hashContent(formatLogMetricJson(metric.attributes));
}

/** Datadog fixes `compute` (aggregation type, path, percentiles) at creation
 * and rejects any update to it, so a push must refuse a local change to it. */
export function hasComputeChanged(localAttributes, liveAttributes) {
  return (
    JSON.stringify(localAttributes.compute) !==
    JSON.stringify(liveAttributes.compute)
  );
}

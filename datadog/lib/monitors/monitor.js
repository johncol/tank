/**
 * Fields Datadog's monitor API returns but doesn't accept back on create or
 * update: metadata about the monitor's identity and history, and its live
 * alert state, which changes without anyone editing the monitor. None of
 * them is part of its definition, so they're kept out of the tracked file.
 */
export const READ_ONLY_MONITOR_FIELDS = [
  "id",
  "org_id",
  "multi",
  "created",
  "created_at",
  "modified",
  "deleted",
  "creator",
  "overall_state",
  "overall_state_modified",
  "state",
  "matching_downtimes",
];

/** Lists the read-only fields a monitor definition has, e.g. when it was
 * copied from another monitor's API response. */
export function findReadOnlyMonitorFields(monitor) {
  return READ_ONLY_MONITOR_FIELDS.filter((field) => field in monitor);
}

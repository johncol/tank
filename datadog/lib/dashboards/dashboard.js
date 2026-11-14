/**
 * Fields Datadog's dashboard API returns but doesn't accept back on create
 * or update -- metadata about the dashboard's identity and history, not its
 * content. These are tracked in sync-manifest.yaml instead of the tracked
 * JSON file, keeping the file limited to the dashboard's actual definition.
 */
export const READ_ONLY_DASHBOARD_FIELDS = [
  "id",
  "author_handle",
  "author_name",
  "created_at",
  "modified_at",
  "url",
  "is_read_only",
];

/** Lists the read-only fields a dashboard definition has, e.g. when it was
 * copied from another dashboard's API response. */
export function findReadOnlyDashboardFields(dashboard) {
  return READ_ONLY_DASHBOARD_FIELDS.filter((field) => field in dashboard);
}

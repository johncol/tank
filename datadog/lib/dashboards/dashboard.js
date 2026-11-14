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

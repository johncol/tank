/**
 * Fields Datadog's dashboard API returns but doesn't accept back on create
 * or update -- metadata about the dashboard's identity and history, not its
 * content. These are tracked in sync-manifest.yaml instead of the tracked
 * JSON file, keeping the file limited to the dashboard's actual definition.
 */
const READ_ONLY_FIELDS = [
  "id",
  "author_handle",
  "author_name",
  "created_at",
  "modified_at",
  "url",
  "is_read_only",
];

/** Strips Datadog's read-only dashboard metadata, leaving only the fields
 * that make up the dashboard's write payload (title, widgets, etc.). */
export function stripReadOnlyDashboardFields(dashboard) {
  const cloned = { ...dashboard };

  for (const field of READ_ONLY_FIELDS) {
    delete cloned[field];
  }

  return cloned;
}

/** Serializes a dashboard definition as pretty-printed JSON, so tracked
 * files stay human-readable and diff cleanly. */
export function formatDashboardJson(dashboard) {
  return `${JSON.stringify(dashboard, null, 2)}\n`;
}

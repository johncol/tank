import test from "node:test";
import assert from "node:assert/strict";
import { formatJson, omitFields } from "../../../../shared/json.js";
import { READ_ONLY_DASHBOARD_FIELDS } from "../dashboard.js";

test("omitFields with READ_ONLY_DASHBOARD_FIELDS removes server-only metadata", () => {
  const dashboard = {
    id: "abc-def-123",
    title: "My Dashboard",
    author_handle: "someone@example.com",
    author_name: "Someone",
    created_at: "2026-01-01T00:00:00.000Z",
    modified_at: "2026-01-02T00:00:00.000Z",
    url: "/dashboard/abc-def-123",
    is_read_only: false,
    widgets: [],
    layout_type: "ordered",
  };

  const stripped = omitFields(dashboard, READ_ONLY_DASHBOARD_FIELDS);

  assert.deepEqual(stripped, {
    title: "My Dashboard",
    widgets: [],
    layout_type: "ordered",
  });
});

test("omitFields with READ_ONLY_DASHBOARD_FIELDS doesn't mutate the input", () => {
  const dashboard = { id: "abc", title: "My Dashboard" };

  omitFields(dashboard, READ_ONLY_DASHBOARD_FIELDS);

  assert.equal(dashboard.id, "abc");
});

test("omitFields with READ_ONLY_DASHBOARD_FIELDS leaves a dashboard with no read-only fields untouched", () => {
  const dashboard = { title: "My Dashboard", widgets: [] };

  assert.deepEqual(
    omitFields(dashboard, READ_ONLY_DASHBOARD_FIELDS),
    dashboard
  );
});

test("formatJson pretty-prints with a trailing newline", () => {
  const formatted = formatJson({ title: "My Dashboard" });

  assert.equal(formatted, '{\n  "title": "My Dashboard"\n}\n');
});

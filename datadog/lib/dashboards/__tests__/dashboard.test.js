import test from "node:test";
import assert from "node:assert/strict";
import {
  stripReadOnlyDashboardFields,
  formatDashboardJson,
} from "../dashboard.js";

test("stripReadOnlyDashboardFields removes server-only metadata", () => {
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

  const stripped = stripReadOnlyDashboardFields(dashboard);

  assert.deepEqual(stripped, {
    title: "My Dashboard",
    widgets: [],
    layout_type: "ordered",
  });
});

test("stripReadOnlyDashboardFields doesn't mutate the input", () => {
  const dashboard = { id: "abc", title: "My Dashboard" };

  stripReadOnlyDashboardFields(dashboard);

  assert.equal(dashboard.id, "abc");
});

test("stripReadOnlyDashboardFields leaves a dashboard with no read-only fields untouched", () => {
  const dashboard = { title: "My Dashboard", widgets: [] };

  assert.deepEqual(stripReadOnlyDashboardFields(dashboard), dashboard);
});

test("formatDashboardJson pretty-prints with a trailing newline", () => {
  const formatted = formatDashboardJson({ title: "My Dashboard" });

  assert.equal(formatted, '{\n  "title": "My Dashboard"\n}\n');
});

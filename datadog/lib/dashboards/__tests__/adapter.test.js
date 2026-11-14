import test from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "yaml";
import { dashboardAdapter } from "../adapter.js";
import { formatJson } from "../../../../shared/json.js";

test("dashboardAdapter names a fetched file from the dashboard title", () => {
  const artifactPath = dashboardAdapter.buildFetchPath({
    client: null,
    document: parseDocument("{}"),
    id: "abc-def-123",
    remote: { title: "Dynamic Rendering: Overview" },
  });

  assert.equal(
    artifactPath,
    "synced/dashboards/dynamic-rendering-overview.json"
  );
});

test("dashboardAdapter keeps read-only fields out of the file, and reads modified_at as remoteVersion", () => {
  const description = dashboardAdapter.describeRemote({
    id: "abc-def-123",
    title: "My Dashboard",
    modified_at: "2026-01-02T00:00:00.000Z",
    widgets: [],
  });

  assert.deepEqual(description, {
    title: "My Dashboard",
    remoteVersion: "2026-01-02T00:00:00.000Z",
    content: '{\n  "title": "My Dashboard",\n  "widgets": []\n}\n',
  });
});

test("dashboardAdapter refuses to create from a file with read-only fields, without calling Datadog", async () => {
  let createCount = 0;
  const client = {
    async createDashboard() {
      createCount += 1;
    },
  };

  await assert.rejects(
    dashboardAdapter.createRemote(
      client,
      undefined,
      formatJson({ title: "Copied", id: "abc-def-001", url: "/dashboard/x" })
    ),
    /Remove id, url from the file/
  );
  assert.equal(createCount, 0);
});

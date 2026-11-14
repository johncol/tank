import test from "node:test";
import assert from "node:assert/strict";
import { monitorAdapter } from "../adapter.js";
import { formatJson } from "../../../../shared/json.js";

test("monitorAdapter keeps read-only fields and the live alert state out of the file, and reads modified as remoteVersion", () => {
  const description = monitorAdapter.describeRemote({
    id: 23739095,
    org_id: 1300188039,
    name: "Search success rate",
    type: "rum alert",
    query: "formula(...) < 95",
    multi: false,
    created: "2026-11-13T23:19:34.816324+00:00",
    created_at: 1794611974000,
    modified: "2026-11-14T01:55:50.552349+00:00",
    deleted: null,
    creator: { email: "someone@example.com" },
    overall_state: "Alert",
    overall_state_modified: "2026-11-14T02:00:00+00:00",
  });

  assert.deepEqual(description, {
    title: "Search success rate",
    remoteVersion: "2026-11-14T01:55:50.552349+00:00",
    content: formatJson({
      name: "Search success rate",
      type: "rum alert",
      query: "formula(...) < 95",
    }),
  });
});

test("monitorAdapter only counts a monitor with the exact same name as a duplicate, since Datadog's name filter matches part of it", async () => {
  const client = {
    async listMonitorsByName() {
      return [
        { id: 1, name: "search success rate (copy)" },
        { id: 2, name: "Search success rate" },
      ];
    },
  };

  assert.equal(
    await monitorAdapter.findRemoteIdByContent(
      client,
      formatJson({ name: "Search success rate" })
    ),
    "2"
  );
  assert.equal(
    await monitorAdapter.findRemoteIdByContent(
      client,
      formatJson({ name: "Search success" })
    ),
    null
  );
});

test("monitorAdapter refuses to create from a file with read-only fields, without calling Datadog", async () => {
  let createCount = 0;
  const client = {
    async createMonitor() {
      createCount += 1;
    },
  };

  await assert.rejects(
    monitorAdapter.createRemote(
      client,
      undefined,
      formatJson({ name: "Copied", id: 1, overall_state: "OK" })
    ),
    /Remove id, overall_state from the file/
  );
  assert.equal(createCount, 0);
});

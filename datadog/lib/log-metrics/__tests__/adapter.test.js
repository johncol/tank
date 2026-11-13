import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import { logMetricAdapter } from "../adapter.js";
import { formatLogMetricJson } from "../log-metric.js";
import { fetchOne, pushOne, createOne } from "../../../../shared/actions.js";
import { listManifestEntries } from "../../../../shared/manifest.js";

const METRIC_ID = "adapter.test.metric";
const METRIC_PATH = `synced/log-metrics/${METRIC_ID}.json`;

// Each test gets its own folder here, so tests never write to the real
// datadog/ folder.
const TEMP_BASE_DIR = path.join(os.tmpdir(), "log-metric-adapter-test");

after(() => rm(TEMP_BASE_DIR, { recursive: true, force: true }));

let adapter;
let document;

beforeEach(async () => {
  await mkdir(TEMP_BASE_DIR, { recursive: true });
  const rootDir = await mkdtemp(path.join(TEMP_BASE_DIR, "log-metric-"));

  adapter = { ...logMetricAdapter, rootDir };
  document = parseDocument("{}");
});

afterEach(() => rm(adapter.rootDir, { recursive: true, force: true }));

function resolve(artifactPath) {
  return path.join(adapter.rootDir, artifactPath);
}

async function writeLocalMetric(attributes) {
  await mkdir(path.dirname(resolve(METRIC_PATH)), { recursive: true });
  await writeFile(
    resolve(METRIC_PATH),
    formatLogMetricJson(attributes),
    "utf8"
  );
}

function buildNotFoundError() {
  return Object.assign(new Error("Datadog API GET failed with 404"), {
    status: 404,
  });
}

test("push refuses a change to compute, even with --force, and sends only filter and group_by otherwise", async () => {
  const liveMetric = {
    id: METRIC_ID,
    attributes: {
      filter: { query: "service:web" },
      compute: { aggregation_type: "count" },
    },
  };
  const updateCalls = [];
  const client = {
    async getLogMetric() {
      return structuredClone(liveMetric);
    },
    async updateLogMetric(id, attributes) {
      updateCalls.push({ id, attributes });
      return { id, attributes: { ...liveMetric.attributes, ...attributes } };
    },
  };

  const [fetched] = await fetchOne(adapter, client, document, METRIC_ID);
  assert.equal(fetched.status, "success", fetched.message);
  const entry = listManifestEntries(document)[0];

  await writeLocalMetric({
    filter: { query: "service:web" },
    compute: { aggregation_type: "distribution", path: "@duration" },
  });

  const [refused] = await pushOne(adapter, client, document, entry, {
    force: true,
  });

  assert.equal(refused.status, "failed");
  assert.equal(
    refused.message,
    "`compute` can't be changed on an existing log-based metric; Datadog fixes it at creation. Revert the local change to `compute`."
  );
  assert.deepEqual(updateCalls, []);

  await writeLocalMetric({
    filter: { query: "service:web env:prod" },
    compute: { aggregation_type: "count" },
  });

  const [pushed] = await pushOne(adapter, client, document, entry);

  assert.equal(pushed.status, "success", pushed.message);
  assert.deepEqual(updateCalls, [
    {
      id: METRIC_ID,
      attributes: { filter: { query: "service:web env:prod" }, group_by: [] },
    },
  ]);
});

test("create sends group_by as [] when the file leaves it out, and rewrites the file with what Datadog returns", async () => {
  const createCalls = [];
  const createdMetric = {
    id: METRIC_ID,
    attributes: {
      filter: { query: "service:web" },
      group_by: [],
      compute: { aggregation_type: "count", include_percentiles: false },
    },
  };
  const client = {
    async getLogMetric() {
      throw buildNotFoundError();
    },
    async createLogMetric(id, attributes) {
      createCalls.push({ id, attributes });
      return structuredClone(createdMetric);
    },
  };
  await writeLocalMetric({
    filter: { query: "service:web" },
    compute: { aggregation_type: "count" },
  });

  const [result] = await createOne(adapter, client, document, {
    id: METRIC_ID,
  });

  assert.equal(result.status, "success", result.message);
  assert.deepEqual(createCalls, [
    {
      id: METRIC_ID,
      attributes: {
        filter: { query: "service:web" },
        group_by: [],
        compute: { aggregation_type: "count" },
      },
    },
  ]);
  assert.equal(
    await readFile(resolve(METRIC_PATH), "utf8"),
    formatLogMetricJson(createdMetric.attributes)
  );
  assert.equal(listManifestEntries(document)[0].title, METRIC_ID);
});

test("create reports a metric that already exists when Datadog answers 409", async () => {
  const client = {
    async getLogMetric() {
      throw buildNotFoundError();
    },
    async createLogMetric() {
      throw Object.assign(new Error("Datadog API POST failed with 409"), {
        status: 409,
      });
    },
  };
  await writeLocalMetric({
    filter: { query: "service:web" },
    compute: { aggregation_type: "count" },
  });

  const [result] = await createOne(adapter, client, document, {
    id: METRIC_ID,
  });

  assert.equal(result.status, "failed");
  assert.equal(
    result.message,
    `Datadog log-based metric ${METRIC_ID} already exists in Datadog. Use --fetch to track it instead.`
  );
  assert.deepEqual(listManifestEntries(document), []);
});

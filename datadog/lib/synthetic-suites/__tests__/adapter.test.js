import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import { syntheticSuiteAdapter } from "../adapter.js";
import { syntheticTestAdapter } from "../../synthetic-tests/adapter.js";
import { fetchOne, pullOne, deleteOne } from "../../../../shared/actions.js";
import {
  listManifestEntries,
  updateManifestEntry,
} from "../../../../shared/manifest.js";

const SUITE_ID = "sss-111";
const SUITE_FOLDER = "synced/synthetics/checkout-suite";
const SUITE_PATH = `${SUITE_FOLDER}/_suite.json`;
const TRACKED_TEST_PATH = "synced/synthetics/_no-suite/tracked-test.json";

// Each test gets its own folder here, so tests never write to the real
// datadog/ folder.
const TEMP_BASE_DIR = path.join(os.tmpdir(), "synthetic-suite-adapter-test");

after(() => rm(TEMP_BASE_DIR, { recursive: true, force: true }));

let adapter;
let testAdapter;
let document;

beforeEach(async () => {
  await mkdir(TEMP_BASE_DIR, { recursive: true });
  const rootDir = await mkdtemp(path.join(TEMP_BASE_DIR, "synthetic-suite-"));

  adapter = { ...syntheticSuiteAdapter, rootDir };
  testAdapter = { ...syntheticTestAdapter, rootDir };
  document = parseDocument("{}");
});

afterEach(() => rm(adapter.rootDir, { recursive: true, force: true }));

function resolve(artifactPath) {
  return path.join(adapter.rootDir, artifactPath);
}

/** Fetches the suite as runCli does, with the test adapter for its tests. */
function fetchSuite(client, { force = false } = {}) {
  return fetchOne(adapter, client, document, SUITE_ID, {
    force,
    followUpAdapter: testAdapter,
  });
}

/** Pulls the suite as runCli does, with the test adapter for its tests. */
function pullSuite(client, entry) {
  return pullOne(adapter, client, document, entry, {
    followUpAdapter: testAdapter,
  });
}

/** A fake Datadog holding one suite with the given member test IDs. */
function createFakeDatadog(testIds) {
  const fake = {
    suite: {
      public_id: SUITE_ID,
      name: "Checkout suite",
      tests: testIds.map((testId) => ({ public_id: testId })),
      modified_at: "2026-01-01T00:00:00.000Z",
    },
    fetchedTestIds: [],
    testNames: {},
    client: {
      async getSyntheticSuite() {
        return structuredClone(fake.suite);
      },
      async getSyntheticTest(testId) {
        fake.fetchedTestIds.push(testId);
        return {
          public_id: testId,
          name: fake.testNames[testId] ?? `Test ${testId}`,
          type: "api",
          modified_at: "2026-01-01T00:00:00.000Z",
        };
      },
      async getSyntheticTestParentSuites() {
        return [{ public_id: SUITE_ID, name: fake.suite.name }];
      },
      async deleteSyntheticSuite() {},
    },
  };

  return fake;
}

function trackTest(testId) {
  updateManifestEntry(document, TRACKED_TEST_PATH, {
    kind: "synthetic-test",
    id: testId,
  });
}

function summarize(results) {
  return results.map((result) => [
    result.kind,
    result.path,
    result.action,
    result.status,
  ]);
}

test("fetch also fetches the suite's untracked tests into its folder, after the suite's own result", async () => {
  trackTest("ttt-tracked");
  const fake = createFakeDatadog(["ttt-new", "ttt-tracked"]);

  const results = await fetchSuite(fake.client);

  assert.deepEqual(summarize(results), [
    ["synthetic-suite", SUITE_PATH, "fetch", "success"],
    ["synthetic-test", `${SUITE_FOLDER}/test-ttt-new.json`, "fetch", "success"],
  ]);
  assert.deepEqual(fake.fetchedTestIds, ["ttt-new"]);
  assert.match(
    await readFile(resolve(`${SUITE_FOLDER}/test-ttt-new.json`), "utf8"),
    /Test ttt-new/
  );
});

test("fetch never passes --force on to its tests", async () => {
  const fake = createFakeDatadog(["ttt-new"]);
  const untrackedTestPath = `${SUITE_FOLDER}/test-ttt-new.json`;
  await mkdir(resolve(SUITE_FOLDER), { recursive: true });
  await writeFile(resolve(SUITE_PATH), "untracked suite", "utf8");
  await writeFile(resolve(untrackedTestPath), "untracked test", "utf8");

  const results = await fetchSuite(fake.client, { force: true });

  assert.deepEqual(summarize(results), [
    ["synthetic-suite", SUITE_PATH, "fetch", "success"],
    ["synthetic-test", untrackedTestPath, "fetch", "failed"],
  ]);
  assert.match(results[1].message, /already exists/);
  assert.equal(
    await readFile(resolve(untrackedTestPath), "utf8"),
    "untracked test"
  );
});

test("pull fetches tests added to the suite in Datadog, and leaves tracked ones alone", async () => {
  const fake = createFakeDatadog([]);
  await fetchSuite(fake.client);
  const suiteEntry = listManifestEntries(document).find(
    (entry) => entry.id === SUITE_ID
  );
  fake.suite.tests = [{ public_id: "ttt-added" }];

  const results = await pullSuite(fake.client, suiteEntry);

  assert.deepEqual(summarize(results), [
    ["synthetic-suite", SUITE_PATH, "pull", "success"],
    [
      "synthetic-test",
      `${SUITE_FOLDER}/test-ttt-added.json`,
      "fetch",
      "success",
    ],
  ]);

  const [skipped, ...followUps] = await pullSuite(
    fake.client,
    listManifestEntries(document).find((entry) => entry.id === SUITE_ID)
  );

  assert.equal(skipped.status, "skipped");
  assert.deepEqual(followUps, [], "already-tracked tests aren't refetched");
});

test("pull fetches same-named tests side by side, so the next pull has none left to fetch", async () => {
  const fake = createFakeDatadog([]);
  await fetchSuite(fake.client);
  fake.suite.tests = [{ public_id: "ttt-one" }, { public_id: "ttt-two" }];
  fake.testNames = { "ttt-one": "Homepage - US", "ttt-two": "Homepage (US)" };
  const findSuiteEntry = () =>
    listManifestEntries(document).find((entry) => entry.id === SUITE_ID);

  const results = await pullSuite(fake.client, findSuiteEntry());

  assert.deepEqual(summarize(results), [
    ["synthetic-suite", SUITE_PATH, "pull", "success"],
    ["synthetic-test", `${SUITE_FOLDER}/homepage-us.json`, "fetch", "success"],
    [
      "synthetic-test",
      `${SUITE_FOLDER}/homepage-us-ttt-two.json`,
      "fetch",
      "success",
    ],
  ]);

  const [skipped, ...followUps] = await pullSuite(
    fake.client,
    findSuiteEntry()
  );

  assert.equal(skipped.status, "skipped");
  assert.deepEqual(followUps, []);
});

test("delete notes that the suite's tests weren't deleted", async () => {
  const fake = createFakeDatadog([]);
  await fetchSuite(fake.client);
  const suiteEntry = listManifestEntries(document).find(
    (entry) => entry.id === SUITE_ID
  );

  const [result] = await deleteOne(adapter, fake.client, document, suiteEntry);

  assert.equal(result.status, "success", result.message);
  assert.equal(
    result.message,
    "The suite's tests weren't deleted. Run --synthetic-tests --pull to move them out of its folder."
  );
});

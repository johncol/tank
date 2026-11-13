import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import { syntheticTestAdapter } from "../adapter.js";
import { fetchOne, pullOne, pushOne } from "../../../../shared/actions.js";
import {
  listManifestEntries,
  updateManifestEntry,
} from "../../../../shared/manifest.js";

const TEST_ID = "ttt-111";
const OLD_SUITE = { public_id: "sss-old", name: "Old suite" };
const NEW_SUITE = { public_id: "sss-new", name: "New suite" };
const OLD_PATH = "synced/synthetics/old-suite/latency-test.json";
const NEW_PATH = "synced/synthetics/new-suite/latency-test.json";

// Each test gets its own folder here, so tests never write to the real
// datadog/ folder.
const TEMP_BASE_DIR = path.join(os.tmpdir(), "synthetic-test-adapter-test");

after(() => rm(TEMP_BASE_DIR, { recursive: true, force: true }));

let adapter;
let document;

beforeEach(async () => {
  await mkdir(TEMP_BASE_DIR, { recursive: true });
  const rootDir = await mkdtemp(path.join(TEMP_BASE_DIR, "synthetic-test-"));

  adapter = { ...syntheticTestAdapter, rootDir };
  document = parseDocument("{}");
});

afterEach(() => rm(adapter.rootDir, { recursive: true, force: true }));

function resolve(artifactPath) {
  return path.join(adapter.rootDir, artifactPath);
}

async function exists(artifactPath) {
  try {
    await access(resolve(artifactPath));
    return true;
  } catch {
    return false;
  }
}

/** A fake Datadog holding one test, in the suites `parentSuites` lists. */
function createFakeDatadog(parentSuites) {
  const fake = {
    parentSuites,
    test: {
      public_id: TEST_ID,
      name: "Latency test",
      type: "api",
      modified_at: "2026-01-01T00:00:00.000Z",
    },
    calls: [],
    client: {
      async getSyntheticTest() {
        fake.calls.push("getSyntheticTest");
        return structuredClone(fake.test);
      },
      async getSyntheticTestParentSuites() {
        fake.calls.push("getSyntheticTestParentSuites");
        return structuredClone(fake.parentSuites);
      },
      async updateSyntheticTest(id, test) {
        fake.calls.push("updateSyntheticTest");
        fake.test = {
          ...test,
          public_id: id,
          modified_at: "2026-01-02T00:00:00.000Z",
        };
        // Datadog doesn't document modified_at in the edit response.
        return { ...test, public_id: id };
      },
    },
  };

  return fake;
}

function trackSuite(suite, folderName) {
  updateManifestEntry(document, `synced/synthetics/${folderName}/_suite.json`, {
    kind: "synthetic-suite",
    id: suite.public_id,
  });
}

async function fetchTest(fake) {
  const [result] = await fetchOne(adapter, fake.client, document, TEST_ID);
  assert.equal(result.status, "success", result.message);

  return listManifestEntries(document).find((entry) => entry.id === TEST_ID);
}

test("fetch puts a test in its tracked suite's folder", async () => {
  trackSuite(OLD_SUITE, "old-suite");
  const fake = createFakeDatadog([OLD_SUITE]);

  const entry = await fetchTest(fake);

  assert.equal(entry.path, OLD_PATH);
});

test("pull moves the file and its entry when the test moved to another suite, removing the emptied folder", async () => {
  trackSuite(NEW_SUITE, "new-suite");
  const fake = createFakeDatadog([OLD_SUITE]);
  const entry = await fetchTest(fake);
  fake.parentSuites = [NEW_SUITE];

  const [result] = await pullOne(adapter, fake.client, document, entry);

  assert.equal(result.status, "success", result.message);
  assert.equal(result.path, NEW_PATH);
  assert.equal(result.movedFrom, OLD_PATH);
  assert.equal(await exists(OLD_PATH), false);
  assert.equal(await exists(path.posix.dirname(OLD_PATH)), false);
  assert.match(await readFile(resolve(NEW_PATH), "utf8"), /Latency test/);

  const manifest = document.toJS();
  assert.equal(manifest[OLD_PATH], undefined);
  assert.equal(manifest[NEW_PATH].id, TEST_ID);
});

test("pull refuses to move, even with --force, when another entry tracks the new path", async () => {
  trackSuite(NEW_SUITE, "new-suite");
  const fake = createFakeDatadog([OLD_SUITE]);
  const entry = await fetchTest(fake);
  updateManifestEntry(document, NEW_PATH, {
    kind: "synthetic-test",
    id: "ttt-other",
  });
  await mkdir(path.dirname(resolve(NEW_PATH)), { recursive: true });
  await writeFile(resolve(NEW_PATH), "other entry's content", "utf8");
  fake.parentSuites = [NEW_SUITE];

  const [result] = await pullOne(adapter, fake.client, document, entry, {
    force: true,
  });

  assert.equal(result.status, "failed");
  assert.match(result.message, /already tracked by another entry/);
  assert.equal(await exists(OLD_PATH), true);
  assert.equal(
    await readFile(resolve(NEW_PATH), "utf8"),
    "other entry's content"
  );

  const manifest = document.toJS();
  assert.equal(manifest[NEW_PATH].id, "ttt-other");
  assert.equal(manifest[OLD_PATH].id, TEST_ID);
});

test("push re-reads modified_at after the update, since the edit response leaves it out", async () => {
  const fake = createFakeDatadog([]);
  const entry = await fetchTest(fake);
  const content = await readFile(resolve(entry.path), "utf8");
  await writeFile(
    resolve(entry.path),
    content.replace("Latency test", "Latency test, edited"),
    "utf8"
  );

  const [result] = await pushOne(adapter, fake.client, document, entry);

  assert.equal(result.status, "success", result.message);
  assert.equal(result.remoteVersion, "2026-01-02T00:00:00.000Z");
  assert.equal(
    document.toJS()[entry.path].remoteVersion,
    "2026-01-02T00:00:00.000Z"
  );
  assert.deepEqual(fake.calls.slice(-2), [
    "updateSyntheticTest",
    "getSyntheticTest",
  ]);
});

test("lists every suite the test belongs to as its parents, tracked or not", async () => {
  const fake = createFakeDatadog([OLD_SUITE, NEW_SUITE]);

  assert.deepEqual(await adapter.parent.listParentIds(fake.client, TEST_ID), [
    "sss-old",
    "sss-new",
  ]);
});

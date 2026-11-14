import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashContent } from "../../shared/hash.js";
import { collectStatus } from "../status.js";

const TOOLS = [{ name: "datadog" }, { name: "confluence" }];

let rootDir;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), "tank-status-"));
});

afterEach(() => rm(rootDir, { recursive: true, force: true }));

async function writeProjectFile(relativePath, content) {
  const filePath = path.join(rootDir, relativePath);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function trackFile(artifactPath, id, content) {
  return (
    `${artifactPath}:\n  kind: "dashboard"\n  id: "${id}"\n` +
    `  contentHash: "${hashContent(content)}"\n`
  );
}

function summarize(results) {
  return results.map((result) => [result.path, result.status, result.state]);
}

test("lists modified, missing, and untracked files, and leaves in-sync ones out", async () => {
  await writeProjectFile(
    "datadog/sync-manifest.yaml",
    "# Header.\n" +
      trackFile("synced/in-sync.json", "1", "same") +
      trackFile("synced/modified.json", "2", "before") +
      trackFile("synced/missing.json", "3", "gone")
  );
  await writeProjectFile("datadog/synced/in-sync.json", "same");
  await writeProjectFile("datadog/synced/modified.json", "after");
  await writeProjectFile("datadog/synced/nested/untracked.json", "new");
  await writeProjectFile("datadog/synced/.DS_Store", "hidden");
  await writeProjectFile("confluence/sync-manifest.yaml", "# Header.\n");

  const results = await collectStatus(rootDir, { tools: TOOLS });

  assert.deepEqual(summarize(results), [
    ["datadog/synced/modified.json", "success", "modified"],
    ["datadog/synced/missing.json", "success", "missing"],
    ["datadog/synced/nested/untracked.json", "success", "untracked"],
  ]);
  assert.equal(results[0].id, "2");
});

test("fails a tool whose manifest is missing, asking to run tank upgrade, and still checks the others", async () => {
  await writeProjectFile("confluence/sync-manifest.yaml", "# Header.\n");
  await writeProjectFile("confluence/synced/page.md", "new");

  const results = await collectStatus(rootDir, { tools: TOOLS });

  assert.deepEqual(summarize(results), [
    ["datadog/sync-manifest.yaml", "failed", undefined],
    ["confluence/synced/page.md", "success", "untracked"],
  ]);
  assert.match(results[0].message, /tank upgrade/);
});

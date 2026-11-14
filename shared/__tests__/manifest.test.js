import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import {
  listManifestEntries,
  parseManifest,
  findEntryById,
  removeManifestEntry,
  saveManifest,
  stringifyManifest,
  updateManifestEntry,
} from "../manifest.js";

const SAMPLE_MANIFEST = `# A header comment that must survive edits.
synced/a.md:
  kind: "page"
  title: "Doc A"
  id: "111"
  lastSyncedAt: "2026-01-01T00:00:00.000Z"
  remoteVersion: 1
  contentHash: "sha256:aaa"
synced/b.md:
  kind: "page"
  title: "Doc B"
  id: "222"
  lastSyncedAt: "2026-01-01T00:00:00.000Z"
  remoteVersion: 1
  contentHash: "sha256:bbb"
`;

function loadSampleEntries() {
  const document = parseDocument(SAMPLE_MANIFEST);

  return { document, entries: listManifestEntries(document) };
}

test("listManifestEntries exposes each entry's YAML key as its path", () => {
  const { entries } = loadSampleEntries();

  assert.deepEqual(
    entries.map((entry) => entry.path),
    ["synced/a.md", "synced/b.md"]
  );
});

test("findEntryById finds the entry of the given kind with the given ID", () => {
  const { entries } = loadSampleEntries();

  assert.equal(findEntryById(entries, "page", "222").path, "synced/b.md");
});

test("findEntryById ignores entries of a different kind, even with a matching ID", () => {
  const { entries } = loadSampleEntries();

  assert.equal(findEntryById(entries, "dashboard", "222"), undefined);
});

test("findEntryById returns undefined for an unknown ID", () => {
  const { entries } = loadSampleEntries();

  assert.equal(findEntryById(entries, "page", "does-not-exist"), undefined);
});

test("findEntryById compares IDs as strings (numeric --id CLI input still matches)", () => {
  const { entries } = loadSampleEntries();

  assert.equal(findEntryById(entries, "page", 222).path, "synced/b.md");
});

test("updateManifestEntry patches only the targeted entry and preserves header comments", () => {
  const { document } = loadSampleEntries();

  updateManifestEntry(document, "synced/a.md", {
    remoteVersion: 2,
    contentHash: "sha256:new",
  });

  const result = document.toJS();
  assert.equal(result["synced/a.md"].remoteVersion, 2);
  assert.equal(result["synced/a.md"].contentHash, "sha256:new");
  assert.equal(
    result["synced/b.md"].remoteVersion,
    1,
    "unrelated entry must be untouched"
  );
  assert.ok(
    String(document).startsWith("# A header comment"),
    "header comment must survive the edit"
  );
});

test("updateManifestEntry auto-vivifies a brand-new entry", () => {
  const { document } = loadSampleEntries();

  updateManifestEntry(document, "synced/c.md", {
    title: "Doc C",
    id: "333",
    remoteVersion: 1,
  });

  const result = document.toJS();
  assert.equal(result["synced/c.md"].title, "Doc C");
  assert.equal(result["synced/c.md"].id, "333");
  assert.equal(result["synced/c.md"].remoteVersion, 1);
});

test("removing the last entry, then adding one, keeps the manifest in block style", () => {
  const document = parseDocument(`# A header comment that must survive edits.

synced/a.md:
  kind: "page"
  id: "111"
`);

  removeManifestEntry(document, "synced/a.md");
  const emptiedText = stringifyManifest(document);

  assert.equal(emptiedText, "# A header comment that must survive edits.\n");

  const emptied = parseManifest(emptiedText, "sync-manifest.yaml");

  assert.deepEqual(emptied.entries, []);
  updateManifestEntry(emptied.document, "synced/b.md", {
    kind: "page",
    id: "222",
  });

  assert.equal(
    String(emptied.document),
    `# A header comment that must survive edits.

synced/b.md:
  kind: "page"
  id: "222"
`
  );
});

test("updateManifestEntry writes a flow-style manifest back in block style", () => {
  const document = parseDocument(`# A header comment that must survive edits.

{ synced/a.md: { kind: "page", id: "111" } }
`);

  updateManifestEntry(document, "synced/b.md", { kind: "page", id: "222" });

  assert.equal(
    String(document),
    `# A header comment that must survive edits.

synced/a.md:
  kind: "page"
  id: "111"
synced/b.md:
  kind: "page"
  id: "222"
`
  );
});

test("parseManifest parses a valid manifest", () => {
  const { entries } = parseManifest(SAMPLE_MANIFEST, "sync-manifest.yaml");

  assert.deepEqual(
    entries.map((entry) => entry.path),
    ["synced/a.md", "synced/b.md"]
  );
});

test("parseManifest fails on merge conflict markers", () => {
  const conflicted = `<<<<<<< HEAD
synced/a.md:
  id: "111"
=======
synced/a.md:
  id: "999"
>>>>>>> other-branch
`;

  assert.throws(
    () => parseManifest(conflicted, "datadog/sync-manifest.yaml"),
    /^Error: datadog\/sync-manifest\.yaml can't be parsed \(merge conflict\?\): .+\. Fix it, then run again\.$/s
  );
});

test("parseManifest fails on duplicate keys", () => {
  const duplicated = `synced/a.md:
  id: "111"
synced/a.md:
  id: "999"
`;

  assert.throws(
    () => parseManifest(duplicated, "sync-manifest.yaml"),
    /sync-manifest\.yaml can't be parsed .*Map keys must be unique/s
  );
});

test("saveManifest replaces the manifest without leaving a temporary file", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "tank-manifest-test-"));
  const manifestPath = path.join(folder, "sync-manifest.yaml");

  try {
    await writeFile(manifestPath, "# Old.\n", "utf8");
    await saveManifest(parseDocument(SAMPLE_MANIFEST), manifestPath);

    assert.equal(await readFile(manifestPath, "utf8"), SAMPLE_MANIFEST);
    assert.deepEqual(await readdir(folder), ["sync-manifest.yaml"]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

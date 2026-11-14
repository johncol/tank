import { describe, test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import {
  fetchOne,
  pullOne,
  pushOne,
  createOne,
  deleteOne,
  runForEach,
} from "../actions.js";
import { listManifestEntries, removeManifestEntry } from "../manifest.js";
import { TOOLS } from "../../project/tools.js";
import { dashboardContractFixture } from "../../datadog/lib/dashboards/__tests__/contract-fixture.js";
import { logMetricContractFixture } from "../../datadog/lib/log-metrics/__tests__/contract-fixture.js";
import { syntheticTestContractFixture } from "../../datadog/lib/synthetic-tests/__tests__/contract-fixture.js";
import { syntheticSuiteContractFixture } from "../../datadog/lib/synthetic-suites/__tests__/contract-fixture.js";
import { pageContractFixture } from "../../confluence/lib/pages/__tests__/contract-fixture.js";

/**
 * What each kind supplies to run through the contract.
 *
 * @typedef {Object} FakeRemote
 * @property {any} client A fake API client the adapter can call.
 * @property {(id: string) => void} addRemote Creates a remote artifact.
 * @property {(id: string) => void} changeRemote Changes its content and its
 *   remoteVersion, as an edit in the remote system would.
 * @property {(id: string) => void} [touchRemote] Changes only its
 *   remoteVersion. Leave out for kinds whose remoteVersion is a hash of the
 *   content.
 * @property {(id: string) => void} removeRemote Deletes it, so it 404s.
 * @property {(id: string, title: string) => void} [renameRemote] Sets its
 *   title. Required when the adapter names fetched files from the title.
 * @property {{ addRemote: (id: string) => void, changeRemote: (id: string)
 *   => void, failNextUpdate: () => void }} [parent] The fake parent
 *   remote, for adapters with `parent`. `failNextUpdate` makes adding
 *   a child fail once.
 *
 * @typedef {Object} ContractFixture
 * @property {import("../actions.js").AdapterDefinition} adapter The real
 *   adapter.
 * @property {string[]} sampleIds Two remote IDs that land at different paths.
 * @property {() => FakeRemote} createFakeRemote
 * @property {(content: string) => string} editLocalContent Returns a valid,
 *   different version of a local file's content, as a local edit would.
 * @property {(key: string) => string} [buildNewLocalContent] Returns the
 *   content of a new local file to create the remote from. Required when
 *   the adapter supports create. When the remote assigns the ID, the same
 *   key as addRemote's must produce a duplicate of that remote.
 * @property {import("../actions.js").AdapterDefinition} [parentAdapter] The real
 *   parent adapter, for adapters with `parent`.
 * @property {string} [parentSampleId] A parent remote ID.
 */

/** Every kind run through the contract. Add each new adapter's fixture. */
const FIXTURES = [
  dashboardContractFixture,
  logMetricContractFixture,
  syntheticTestContractFixture,
  syntheticSuiteContractFixture,
  pageContractFixture,
];

const CONTRACT_ACTIONS = ["fetch", "pull", "push", "create", "delete"];

const ACTIONS_ON_ENTRIES = { pull: pullOne, push: pushOne, delete: deleteOne };

const RESULT_FIELDS = [
  "kind",
  "id",
  "path",
  "action",
  "status",
  "remoteVersion",
  "message",
  "movedFrom",
];

// Each test gets its own folder here, so tests never write to the real
// datadog/ or confluence/ folders.
const TEMP_BASE_DIR = path.join(os.tmpdir(), "sync-action-contract");

after(() => rm(TEMP_BASE_DIR, { recursive: true, force: true }));

function assertWellFormed(results, kind) {
  assert.ok(Array.isArray(results), "an action must return an array");
  assert.ok(results.length > 0, "an action must return its own result");
  assert.equal(results[0].kind, kind, "its own result comes first");

  for (const result of results) {
    assert.ok(result.kind, "every result has a kind");
    assert.ok(result.action, "every result has an action");
    assert.ok(
      ["success", "skipped", "failed"].includes(result.status),
      `unexpected status ${result.status}`
    );

    const keys = Object.keys(result);
    const expectedOrder = RESULT_FIELDS.filter((field) => keys.includes(field));

    assert.deepEqual(keys, expectedOrder, "result fields in contract order");
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function findEntry(document, id) {
  return listManifestEntries(document).find(
    (entry) => String(entry.id) === String(id)
  );
}

test("every tool's adapter is run through the contract", () => {
  const coveredAdapters = FIXTURES.map((fixture) => fixture.adapter);

  for (const [kind, { adapter }] of TOOLS.flatMap((tool) =>
    Object.entries(tool.kinds)
  )) {
    assert.ok(
      coveredAdapters.includes(adapter),
      `${kind} has an adapter but no contract fixture in FIXTURES`
    );
  }
});

for (const fixture of FIXTURES) {
  const { kind, actions } = fixture.adapter;
  const [firstId, secondId] = fixture.sampleIds;
  const namesFilesFromTitle = Boolean(fixture.createFakeRemote().renameRemote);

  describe(`action contract: ${kind}`, () => {
    let adapter;
    let fake;
    let document;

    beforeEach(async () => {
      await mkdir(TEMP_BASE_DIR, { recursive: true });
      const rootDir = await mkdtemp(path.join(TEMP_BASE_DIR, `${kind}-`));

      adapter = { ...fixture.adapter, rootDir };
      fake = fixture.createFakeRemote();
      document = parseDocument("{}");
    });

    afterEach(() => rm(adapter.rootDir, { recursive: true, force: true }));

    function resolve(artifactPath) {
      return path.join(adapter.rootDir, artifactPath);
    }

    async function call(action, ...args) {
      const results = await action(adapter, fake.client, ...args);
      assertWellFormed(results, kind);
      return results;
    }

    /** Starts tracking a new remote artifact, via fetch. */
    async function track(id) {
      fake.addRemote(id);
      const [result] = await call(fetchOne, document, id);
      assert.equal(result.status, "success", result.message);
      return findEntry(document, id);
    }

    test("declares only contract actions", () => {
      for (const action of actions) {
        assert.ok(CONTRACT_ACTIONS.includes(action), action);
      }
    });

    for (const action of CONTRACT_ACTIONS.filter(
      (candidate) => !actions.includes(candidate)
    )) {
      test(`rejects --${action}, which it doesn't support`, async () => {
        const entry = await track(firstId);
        const [result] =
          action === "fetch"
            ? await call(fetchOne, document, secondId)
            : action === "create"
              ? await call(createOne, document, { id: secondId })
              : await call(ACTIONS_ON_ENTRIES[action], document, entry);

        assert.equal(result.status, "failed");
        assert.match(result.message, /isn't supported/);
        assert.deepEqual(findEntry(document, firstId), entry);
      });
    }

    if (actions.includes("fetch")) {
      describe("fetch", () => {
        test("writes the file and adds a complete entry", async () => {
          fake.addRemote(firstId);

          const [result] = await call(fetchOne, document, firstId);

          assert.equal(result.status, "success", result.message);
          assert.equal(result.action, "fetch");
          assert.equal(String(result.id), firstId);

          const entry = findEntry(document, firstId);
          assert.equal(entry.path, result.path);
          assert.deepEqual(Object.keys(entry), [
            "path",
            "kind",
            "title",
            "id",
            "lastSyncedAt",
            "remoteVersion",
            "contentHash",
          ]);
          assert.equal(entry.kind, kind);
          assert.equal(entry.remoteVersion, result.remoteVersion);
          assert.ok(await exists(resolve(result.path)));
        });

        test("fails when the ID is already tracked", async () => {
          const entry = await track(firstId);
          const before = await readFile(resolve(entry.path), "utf8");
          fake.changeRemote(firstId);

          const [result] = await call(fetchOne, document, firstId, {
            force: true,
          });

          assert.equal(result.status, "failed");
          assert.match(result.message, /already tracked/);
          assert.equal(await readFile(resolve(entry.path), "utf8"), before);
        });

        // A path named from the title moves aside instead (see the test
        // below), so only an explicit file name can land on a tracked path.
        const fileNameCanCollide =
          !namesFilesFromTitle || fixture.adapter.allowsFileName;

        if (fileNameCanCollide) {
          test("fails, even with --force, when another entry tracks the path", async () => {
            const entry = await track(firstId);
            await rm(resolve(entry.path));
            const otherDocument = parseDocument(
              `${JSON.stringify(entry.path)}:\n  kind: "${kind}"\n  id: "${secondId}"\n`
            );

            const [result] = await call(fetchOne, otherDocument, firstId, {
              force: true,
              fileName: namesFilesFromTitle
                ? path.posix.basename(entry.path)
                : undefined,
            });

            assert.equal(result.status, "failed");
            assert.match(result.message, /already tracked by another entry/);
            assert.equal(
              String(findEntry(otherDocument, secondId).path),
              entry.path
            );
            assert.equal(findEntry(otherDocument, firstId), undefined);
            assert.equal(await exists(resolve(entry.path)), false);
          });
        }

        test("fails when an untracked file exists at the path; --force overwrites it", async () => {
          const entry = await track(firstId);
          await writeFile(resolve(entry.path), "untracked content", "utf8");
          document = parseDocument("{}");

          const [failed] = await call(fetchOne, document, firstId);

          assert.equal(failed.status, "failed");
          assert.match(failed.message, /already exists/);
          assert.equal(
            await readFile(resolve(entry.path), "utf8"),
            "untracked content"
          );
          assert.equal(findEntry(document, firstId), undefined);

          const [forced] = await call(fetchOne, document, firstId, {
            force: true,
          });

          assert.equal(forced.status, "success", forced.message);
          assert.notEqual(
            await readFile(resolve(entry.path), "utf8"),
            "untracked content"
          );
        });

        test("fails when the remote doesn't exist", async () => {
          const [result] = await call(fetchOne, document, firstId);

          assert.equal(result.status, "failed");
          assert.equal(findEntry(document, firstId), undefined);
        });

        if (namesFilesFromTitle) {
          test("adds the ID to the path when another entry's title has the same slug", async () => {
            fake.addRemote(firstId);
            fake.addRemote(secondId);
            fake.renameRemote(firstId, "Homepage - US");
            fake.renameRemote(secondId, "Homepage (US)");

            const [first] = await call(fetchOne, document, firstId);
            const [second] = await call(fetchOne, document, secondId);

            assert.equal(first.status, "success", first.message);
            assert.equal(second.status, "success", second.message);
            assert.match(first.path, /\/homepage-us[/.]/);
            assert.equal(
              second.path,
              first.path.replace("homepage-us", `homepage-us-${secondId}`)
            );

            const [pulled] = await call(
              pullOne,
              document,
              findEntry(document, secondId)
            );

            assert.notEqual(pulled.status, "failed", pulled.message);
            assert.equal(pulled.path, second.path);
            assert.equal(findEntry(document, secondId).path, second.path);
          });

          test("names the path from the ID when the title has no slug", async () => {
            fake.addRemote(firstId);
            fake.renameRemote(firstId, "日本語 ✓");

            const [result] = await call(fetchOne, document, firstId);

            assert.equal(result.status, "success", result.message);
            assert.ok(result.path.includes(`/${firstId}`), result.path);
            assert.doesNotMatch(result.path, /\/\.|\/\//);
          });
        }

        if (fixture.adapter.allowsFileName) {
          test("names the file from a kebab-case file name, with or without its suffix", async () => {
            fake.addRemote(firstId);
            fake.addRemote(secondId);
            const suffix = fixture.adapter.fileNameSuffix ?? "";

            const [withoutSuffix] = await call(fetchOne, document, firstId, {
              fileName: "custom-name",
            });
            const [withSuffix] = await call(fetchOne, document, secondId, {
              fileName: `other-name${suffix}`,
            });

            assert.equal(
              path.posix.basename(withoutSuffix.path),
              `custom-name${suffix}`
            );
            assert.equal(
              path.posix.basename(withSuffix.path),
              `other-name${suffix}`
            );
          });

          test("fails when the file name isn't kebab-case", async () => {
            fake.addRemote(firstId);

            const [result] = await call(fetchOne, document, firstId, {
              fileName: "Not Kebab Case",
            });

            assert.equal(result.status, "failed");
            assert.match(result.message, /kebab-case/);
            assert.equal(findEntry(document, firstId), undefined);
          });
        } else {
          test("rejects a file name", async () => {
            fake.addRemote(firstId);

            const [result] = await call(fetchOne, document, firstId, {
              fileName: "custom-name",
            });

            assert.equal(result.status, "failed");
          });
        }
      });
    }

    if (actions.includes("pull")) {
      describe("pull", () => {
        test("writes remote changes and updates the entry", async () => {
          const entry = await track(firstId);
          const before = await readFile(resolve(entry.path), "utf8");
          fake.changeRemote(firstId);

          const [result] = await call(pullOne, document, entry);

          assert.equal(result.status, "success", result.message);
          const updated = findEntry(document, firstId);
          assert.notEqual(await readFile(resolve(entry.path), "utf8"), before);
          assert.equal(updated.remoteVersion, result.remoteVersion);
          assert.notEqual(updated.remoteVersion, entry.remoteVersion);
          assert.notEqual(updated.contentHash, entry.contentHash);
        });

        test("fails with unpushed local changes; --force discards them", async () => {
          const entry = await track(firstId);
          const edited = fixture.editLocalContent(
            await readFile(resolve(entry.path), "utf8")
          );
          await writeFile(resolve(entry.path), edited, "utf8");
          fake.changeRemote(firstId);

          const [failed] = await call(pullOne, document, entry);

          assert.equal(failed.status, "failed");
          assert.match(failed.message, /unsynced changes/);
          assert.equal(await readFile(resolve(entry.path), "utf8"), edited);
          assert.deepEqual(findEntry(document, firstId), entry);

          const [forced] = await call(pullOne, document, entry, {
            force: true,
          });

          assert.equal(forced.status, "success", forced.message);
          assert.notEqual(await readFile(resolve(entry.path), "utf8"), edited);
        });

        test("is skipped, without bumping lastSyncedAt, when nothing changed", async () => {
          const entry = await track(firstId);

          const [result] = await call(pullOne, document, entry);

          assert.equal(result.status, "skipped");
          assert.equal(result.remoteVersion, entry.remoteVersion);
          assert.deepEqual(findEntry(document, firstId), entry);
        });

        if (fixture.createFakeRemote().touchRemote) {
          test("updates only the entry when only remoteVersion changed", async () => {
            const entry = await track(firstId);
            fake.touchRemote(firstId);

            const [result] = await call(pullOne, document, entry);

            assert.equal(result.status, "success", result.message);
            const updated = findEntry(document, firstId);
            assert.notEqual(updated.remoteVersion, entry.remoteVersion);
            assert.equal(updated.remoteVersion, result.remoteVersion);
            assert.equal(updated.lastSyncedAt, entry.lastSyncedAt);
            assert.equal(updated.contentHash, entry.contentHash);
          });
        }

        test("restores a missing local file", async () => {
          const entry = await track(firstId);
          const before = await readFile(resolve(entry.path), "utf8");
          await rm(resolve(entry.path));

          const [result] = await call(pullOne, document, entry);

          assert.equal(result.status, "success", result.message);
          assert.equal(await readFile(resolve(entry.path), "utf8"), before);
        });

        test("fails when the remote no longer exists", async () => {
          const entry = await track(firstId);
          fake.removeRemote(firstId);

          const [result] = await call(pullOne, document, entry, {
            force: true,
          });

          assert.equal(result.status, "failed");
          assert.match(result.message, /no longer exists/);
          assert.deepEqual(findEntry(document, firstId), entry);
        });

        test("runs on every tracked entry of the kind", async () => {
          await track(firstId);
          await track(secondId);

          const results = await runForEach(
            adapter,
            fake.client,
            document,
            pullOne
          );

          assertWellFormed(results, kind);
          assert.deepEqual(
            results.map((result) => String(result.id)),
            [firstId, secondId]
          );
        });
      });
    }

    if (actions.includes("push")) {
      describe("push", () => {
        async function editLocally(entry) {
          const edited = fixture.editLocalContent(
            await readFile(resolve(entry.path), "utf8")
          );
          await writeFile(resolve(entry.path), edited, "utf8");
          return edited;
        }

        test("writes local changes and updates the entry", async () => {
          const entry = await track(firstId);
          await editLocally(entry);

          const [result] = await call(pushOne, document, entry);

          assert.equal(result.status, "success", result.message);
          const updated = findEntry(document, firstId);
          assert.equal(updated.remoteVersion, result.remoteVersion);
          assert.notEqual(updated.remoteVersion, entry.remoteVersion);
          assert.notEqual(updated.contentHash, entry.contentHash);
        });

        test("is skipped when the local file is unchanged; --force pushes anyway", async () => {
          const entry = await track(firstId);
          let updateCount = 0;
          const { updateRemote } = adapter;
          adapter = {
            ...adapter,
            async updateRemote(...args) {
              updateCount += 1;
              return updateRemote(...args);
            },
          };

          const [skipped] = await call(pushOne, document, entry);

          assert.equal(skipped.status, "skipped");
          assert.equal(updateCount, 0);
          assert.deepEqual(findEntry(document, firstId), entry);

          const [forced] = await call(pushOne, document, entry, {
            force: true,
          });

          assert.equal(forced.status, "success", forced.message);
          assert.equal(updateCount, 1);
          assert.equal(
            findEntry(document, firstId).remoteVersion,
            forced.remoteVersion
          );
        });

        test("fails when the remote changed since the last sync; --force overwrites it", async () => {
          const entry = await track(firstId);
          await editLocally(entry);
          fake.changeRemote(firstId);

          const [failed] = await call(pushOne, document, entry);

          assert.equal(failed.status, "failed");
          assert.match(failed.message, /changed since the last sync/);
          assert.deepEqual(findEntry(document, firstId), entry);

          const [forced] = await call(pushOne, document, entry, {
            force: true,
          });

          assert.equal(forced.status, "success", forced.message);
        });

        test("fails when the local file is missing", async () => {
          const entry = await track(firstId);
          await rm(resolve(entry.path));

          const [result] = await call(pushOne, document, entry, {
            force: true,
          });

          assert.equal(result.status, "failed");
          assert.match(result.message, /missing/);
        });

        test("fails when the remote no longer exists", async () => {
          const entry = await track(firstId);
          await editLocally(entry);
          fake.removeRemote(firstId);

          const [result] = await call(pushOne, document, entry, {
            force: true,
          });

          assert.equal(result.status, "failed");
          assert.match(result.message, /no longer exists/);
        });
      });
    }

    if (actions.includes("create")) {
      describe("create", () => {
        const assignsId = Boolean(fixture.adapter.assignsIdOnCreate);
        const newFileName = "contract-new-artifact";
        // What --create gets: the ID, or a file name when the remote assigns
        // the ID.
        const newTarget = assignsId
          ? { fileName: newFileName }
          : { id: firstId };

        /** Writes a new local file where `target` creates from. `contentKey`
         * picks the content; the same key as addRemote's makes a duplicate. */
        async function writeNewLocalFile(
          target,
          { contentKey = target.id ?? target.fileName, parentEntry } = {}
        ) {
          assert.ok(
            fixture.buildNewLocalContent,
            "a fixture for an adapter that supports create needs buildNewLocalContent"
          );
          const artifactPath = adapter.buildCreatePath({
            ...target,
            parentEntry,
          });
          const content = fixture.buildNewLocalContent(contentKey);
          await mkdir(path.dirname(resolve(artifactPath)), {
            recursive: true,
          });
          await writeFile(resolve(artifactPath), content, "utf8");
          return { artifactPath, content };
        }

        async function remoteExists(id) {
          try {
            await adapter.getRemote(fake.client, id);
            return true;
          } catch {
            return false;
          }
        }

        /** Whether create wrote a remote for this content. */
        async function wasCreated(content) {
          return assignsId
            ? (await adapter.findRemoteIdByContent(fake.client, content)) !==
                null
            : remoteExists(firstId);
        }

        test("creates the remote, rewrites the file with it, and adds a complete entry", async () => {
          const { artifactPath } = await writeNewLocalFile(newTarget);

          const results = await call(createOne, document, newTarget);
          const [result] = results;

          assert.equal(results.length, 1);
          assert.equal(result.status, "success", result.message);
          assert.equal(result.action, "create");
          assert.equal(result.path, artifactPath);
          assert.ok(result.id !== undefined, "the result has the remote ID");
          assert.ok(await remoteExists(result.id));

          const remote = await adapter.getRemote(fake.client, result.id);
          const description = adapter.describeRemote(remote);
          const content = await readFile(resolve(artifactPath), "utf8");
          assert.equal(content, description.content);

          const entry = findEntry(document, result.id);
          assert.deepEqual(Object.keys(entry), [
            "path",
            "kind",
            "title",
            "id",
            "lastSyncedAt",
            "remoteVersion",
            "contentHash",
          ]);
          assert.equal(entry.path, artifactPath);
          assert.equal(entry.kind, kind);
          assert.equal(entry.remoteVersion, result.remoteVersion);
          assert.equal(entry.remoteVersion, description.remoteVersion);

          const [pulled] = await call(pullOne, document, entry);
          assert.equal(pulled.status, "skipped", "entry matches the remote");
        });

        if (!assignsId) {
          test("fails when the ID is already tracked", async () => {
            const entry = await track(firstId);
            const before = await readFile(resolve(entry.path), "utf8");

            const [result] = await call(createOne, document, { id: firstId });

            assert.equal(result.status, "failed");
            assert.match(result.message, /already tracked.*--push/);
            assert.deepEqual(findEntry(document, firstId), entry);
            assert.equal(await readFile(resolve(entry.path), "utf8"), before);
          });
        }

        if (assignsId) {
          test("fails when another entry tracks the path", async () => {
            const entry = await track(firstId);
            const fileName = path.posix.basename(
              entry.path,
              adapter.fileNameSuffix
            );
            assert.equal(adapter.buildCreatePath({ fileName }), entry.path);
            const before = await readFile(resolve(entry.path), "utf8");

            const [result] = await call(createOne, document, { fileName });

            assert.equal(result.status, "failed");
            assert.match(result.message, /already tracked.*--push/);
            assert.deepEqual(findEntry(document, firstId), entry);
            assert.equal(await readFile(resolve(entry.path), "utf8"), before);
          });

          test("fails when the file name isn't kebab-case", async () => {
            const [result] = await call(createOne, document, {
              fileName: "Not Kebab",
            });

            assert.equal(result.status, "failed");
            assert.match(result.message, /kebab-case/);
          });
        }

        test("fails when the local file is missing", async () => {
          const [result] = await call(createOne, document, newTarget);

          assert.equal(result.status, "failed");
          assert.match(result.message, /doesn't exist/);
          assert.equal(listManifestEntries(document).length, 0);
        });

        test("fails when the remote already exists", async () => {
          fake.addRemote(firstId);
          const { artifactPath, content } = await writeNewLocalFile(newTarget, {
            contentKey: firstId,
          });

          const [result] = await call(createOne, document, newTarget);

          assert.equal(result.status, "failed");
          assert.match(result.message, /already exists.*--fetch/);
          assert.equal(listManifestEntries(document).length, 0);
          assert.equal(await readFile(resolve(artifactPath), "utf8"), content);
        });

        test("fails when the remote appears before the create (409)", async () => {
          adapter = {
            ...adapter,
            async createRemote() {
              throw Object.assign(new Error("Conflict"), { status: 409 });
            },
          };
          const { artifactPath, content } = await writeNewLocalFile(newTarget);

          const [result] = await call(createOne, document, newTarget);

          assert.equal(result.status, "failed");
          assert.match(result.message, /already exists.*--fetch/);
          assert.doesNotMatch(result.message, /undefined/);
          if (assignsId) {
            assert.match(result.message, /with the same title/);
          } else {
            assert.match(result.message, new RegExp(` ${firstId} `));
          }
          assert.equal(listManifestEntries(document).length, 0);
          assert.equal(await readFile(resolve(artifactPath), "utf8"), content);
        });

        if (fixture.adapter.parent) {
          describe("inside a parent", () => {
            const parentId = /** @type {string} */ (fixture.parentSampleId);
            let parent;

            beforeEach(async () => {
              assert.ok(
                fixture.parentAdapter && parentId && fake.parent,
                "a fixture for an adapter with parent needs parentAdapter, parentSampleId, and a fake parent"
              );
              assert.equal(
                fixture.parentAdapter.kind,
                fixture.adapter.parent?.kind
              );
              const parentAdapter = {
                ...fixture.parentAdapter,
                rootDir: adapter.rootDir,
              };

              fake.parent.addRemote(parentId);
              const [fetched] = await fetchOne(
                parentAdapter,
                fake.client,
                document,
                parentId
              );
              assert.equal(fetched.status, "success", fetched.message);
              parent = {
                adapter: parentAdapter,
                entry: findEntry(document, parentId),
              };
            });

            test("adds the new artifact to the parent, and refreshes the parent's file and entry", async () => {
              const { artifactPath } = await writeNewLocalFile(newTarget, {
                parentEntry: parent.entry,
              });

              const results = await call(createOne, document, {
                ...newTarget,
                parent,
              });

              assert.equal(results.length, 2);
              const [result, parentResult] = results;
              assert.equal(result.status, "success", result.message);
              assert.equal(result.path, artifactPath);
              assert.ok(findEntry(document, result.id));
              assert.equal(parentResult.kind, parent.adapter.kind);
              assert.equal(parentResult.id, parentId);
              assert.equal(parentResult.action, "create");
              assert.equal(
                parentResult.status,
                "success",
                parentResult.message
              );

              const liveParent = parent.adapter.describeRemote(
                await parent.adapter.getRemote(fake.client, parentId)
              );
              assert.match(liveParent.content, new RegExp(result.id));
              assert.equal(
                await readFile(resolve(parent.entry.path), "utf8"),
                liveParent.content
              );
              const parentEntry = findEntry(document, parentId);
              assert.equal(parentEntry.remoteVersion, liveParent.remoteVersion);
              assert.equal(
                parentResult.remoteVersion,
                liveParent.remoteVersion
              );
            });

            test("fails, before creating anything, when the parent has unpushed changes", async () => {
              const parentFile = resolve(parent.entry.path);
              await writeFile(
                parentFile,
                fixture.editLocalContent(await readFile(parentFile, "utf8")),
                "utf8"
              );
              const { content } = await writeNewLocalFile(newTarget, {
                parentEntry: parent.entry,
              });

              const [result] = await call(createOne, document, {
                ...newTarget,
                parent,
              });

              assert.equal(result.status, "failed");
              assert.match(result.message, /unpushed changes/);
              assert.equal(await wasCreated(content), false);
            });

            test("fails, before creating anything, when the parent changed since the last sync", async () => {
              fake.parent.changeRemote(parentId);
              const { content } = await writeNewLocalFile(newTarget, {
                parentEntry: parent.entry,
              });

              const [result] = await call(createOne, document, {
                ...newTarget,
                parent,
              });

              assert.equal(result.status, "failed");
              assert.match(result.message, /changed since the last sync/);
              assert.equal(await wasCreated(content), false);
            });

            test("keeps the new artifact tracked when adding it to the parent fails", async () => {
              await writeNewLocalFile(newTarget, {
                parentEntry: parent.entry,
              });
              const parentBefore = await readFile(
                resolve(parent.entry.path),
                "utf8"
              );
              fake.parent.failNextUpdate();

              const [result, parentResult] = await call(createOne, document, {
                ...newTarget,
                parent,
              });

              assert.equal(result.status, "success", result.message);
              assert.ok(findEntry(document, result.id));
              assert.equal(parentResult.status, "failed");
              assert.match(parentResult.message, /created and tracked/);
              assert.deepEqual(findEntry(document, parentId), parent.entry);
              assert.equal(
                await readFile(resolve(parent.entry.path), "utf8"),
                parentBefore
              );
            });

            if (actions.includes("delete")) {
              /** Creates a child inside the parent, and returns its entry. */
              async function createChild() {
                await writeNewLocalFile(newTarget, {
                  parentEntry: parent.entry,
                });
                const [created] = await call(createOne, document, {
                  ...newTarget,
                  parent,
                });
                assert.equal(created.status, "success", created.message);
                return findEntry(document, created.id);
              }

              test("--delete removes it from the parent first, and refreshes the parent's file and entry", async () => {
                const childEntry = await createChild();

                const results = await call(deleteOne, document, childEntry, {
                  parentAdapter: parent.adapter,
                });

                assert.equal(results.length, 2);
                const [result, parentResult] = results;
                assert.equal(result.status, "success", result.message);
                assert.equal(findEntry(document, childEntry.id), undefined);
                assert.equal(parentResult.kind, parent.adapter.kind);
                assert.equal(parentResult.id, parentId);
                assert.equal(parentResult.action, "delete");
                assert.equal(
                  parentResult.status,
                  "success",
                  parentResult.message
                );

                const liveParent = parent.adapter.describeRemote(
                  await parent.adapter.getRemote(fake.client, parentId)
                );
                assert.doesNotMatch(
                  liveParent.content,
                  new RegExp(childEntry.id)
                );
                assert.equal(
                  await readFile(resolve(parent.entry.path), "utf8"),
                  liveParent.content
                );
                assert.equal(
                  findEntry(document, parentId).remoteVersion,
                  liveParent.remoteVersion
                );
              });

              test("--delete fails, before changing anything, when a parent isn't tracked", async () => {
                const childEntry = await createChild();
                removeManifestEntry(document, parent.entry.path);

                const results = await call(deleteOne, document, childEntry, {
                  parentAdapter: parent.adapter,
                });

                assert.equal(results.length, 1);
                assert.equal(results[0].status, "failed");
                assert.match(results[0].message, /untracked.*--fetch/);
                assert.match(results[0].message, new RegExp(parentId));
                assert.deepEqual(
                  findEntry(document, childEntry.id),
                  childEntry
                );
                assert.equal(findEntry(document, parentId), undefined);
              });

              test("--delete fails, before changing anything, when a parent changed since the last sync", async () => {
                const childEntry = await createChild();
                const parentEntry = findEntry(document, parentId);
                fake.parent.changeRemote(parentId);

                const [result] = await call(deleteOne, document, childEntry, {
                  parentAdapter: parent.adapter,
                });

                assert.equal(result.status, "failed");
                assert.match(result.message, /changed since the last sync/);
                assert.deepEqual(
                  findEntry(document, childEntry.id),
                  childEntry
                );
                assert.deepEqual(findEntry(document, parentId), parentEntry);
              });
            }
          });
        }
      });
    }

    if (actions.includes("delete")) {
      describe("delete", () => {
        test("deletes the remote, the file, and the entry", async () => {
          const entry = await track(firstId);

          const [result] = await call(deleteOne, document, entry);

          assert.equal(result.status, "success", result.message);
          assert.equal(findEntry(document, firstId), undefined);
          assert.equal(await exists(resolve(entry.path)), false);

          const [refetch] = await call(fetchOne, document, firstId);
          assert.equal(refetch.status, "failed", "remote must be gone");
        });

        test("deletes even when the local file is missing", async () => {
          const entry = await track(firstId);
          await rm(resolve(entry.path));

          const [result] = await call(deleteOne, document, entry);

          assert.equal(result.status, "success", result.message);
          assert.equal(findEntry(document, firstId), undefined);
        });

        test("fails with unpushed local changes", async () => {
          const entry = await track(firstId);
          const edited = fixture.editLocalContent(
            await readFile(resolve(entry.path), "utf8")
          );
          await writeFile(resolve(entry.path), edited, "utf8");

          const [result] = await call(deleteOne, document, entry);

          assert.equal(result.status, "failed");
          assert.match(result.message, /unsynced changes/);
          assert.deepEqual(findEntry(document, firstId), entry);
          assert.equal(await readFile(resolve(entry.path), "utf8"), edited);
        });

        test("fails when the remote no longer exists; --force only untracks", async () => {
          const entry = await track(firstId);
          fake.removeRemote(firstId);

          const [failed] = await call(deleteOne, document, entry);

          assert.equal(failed.status, "failed");
          assert.match(failed.message, /no longer exists/);
          assert.deepEqual(findEntry(document, firstId), entry);

          const [forced] = await call(deleteOne, document, entry, {
            force: true,
          });

          assert.equal(forced.status, "success", forced.message);
          assert.equal(findEntry(document, firstId), undefined);
          assert.equal(await exists(resolve(entry.path)), false);
        });

        test("fails when the remote changed since the last sync", async () => {
          const entry = await track(firstId);
          fake.changeRemote(firstId);

          const [result] = await call(deleteOne, document, entry);

          assert.equal(result.status, "failed");
          assert.match(result.message, /changed since the last sync/);
          assert.deepEqual(findEntry(document, firstId), entry);
        });
      });
    }
  });
}

import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MANAGED_BLOCK_END, MANAGED_BLOCK_START } from "../managed-block.js";
import { runMigrations } from "../migrations.js";
import { TOOLS } from "../tools.js";
import { upgradeProject } from "../upgrade.js";

const CONFLUENCE_TOOL = TOOLS.find((tool) => tool.name === "confluence");

let rootDir;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), "tank-upgrade-"));
  await writeFile(path.join(rootDir, "tank.env"), "", "utf8");
});

afterEach(() => rm(rootDir, { recursive: true, force: true }));

function readProjectFile(relativePath) {
  return readFile(path.join(rootDir, relativePath), "utf8");
}

function findResult(results, relativePath) {
  return results.find((result) => result.path === relativePath);
}

test("upgrade replaces an outdated manifest header and keeps the entries byte for byte", async () => {
  const entries = `synced/a.md:\n  kind: "page"\n  id: "111"\n\n# A comment between entries.\nsynced/b.md:\n  kind: "page"\n`;
  await mkdir(path.join(rootDir, "confluence"));
  await writeFile(
    path.join(rootDir, "confluence", "sync-manifest.yaml"),
    `# An outdated header.\n#\n\n${entries}`,
    "utf8"
  );

  const results = await upgradeProject(rootDir);

  assert.equal(
    await readProjectFile("confluence/sync-manifest.yaml"),
    `${CONFLUENCE_TOOL.manifestHeader}\n${entries}`
  );
  assert.equal(
    findResult(results, "confluence/sync-manifest.yaml").message,
    "Updated."
  );
});

test("a second upgrade changes nothing", async () => {
  await upgradeProject(rootDir);

  const results = await upgradeProject(rootDir);

  assert.deepEqual(
    results.map((result) => result.status),
    results.map(() => "skipped")
  );
});

test("upgrade replaces the managed block in place, keeping the content around it", async () => {
  await writeFile(
    path.join(rootDir, "AGENTS.md"),
    `# Mine\n\nBefore.\n\n${MANAGED_BLOCK_START}\nOutdated.\n${MANAGED_BLOCK_END}\n\nAfter.\n`,
    "utf8"
  );

  await upgradeProject(rootDir);

  const content = await readProjectFile("AGENTS.md");
  assert.match(
    content,
    new RegExp(
      `^# Mine\\n\\nBefore\\.\\n\\n${MANAGED_BLOCK_START}\\n## tank\\n`
    )
  );
  assert.match(
    content,
    new RegExp(`\\n${MANAGED_BLOCK_END}\\n\\nAfter\\.\\n$`)
  );
  assert.doesNotMatch(content, /Outdated/);
});

test("upgrade replaces a block that names tank's local path with one pointing at tank docs", async () => {
  const oldBlock = `${MANAGED_BLOCK_START}\n## Synced artifacts\n\nSynced using tank (\`~/ReposJohn/tank/README.md\`).\n${MANAGED_BLOCK_END}\n`;
  await writeFile(
    path.join(rootDir, "README.md"),
    `# Mine\n\n${oldBlock}`,
    "utf8"
  );

  await upgradeProject(rootDir);

  const content = await readProjectFile("README.md");
  assert.doesNotMatch(content, /ReposJohn/);
  assert.match(content, /`tank docs`/);
});

test("upgrade appends the managed block after a blank line when the file has no markers", async () => {
  await writeFile(path.join(rootDir, "README.md"), "# Mine\n", "utf8");

  await upgradeProject(rootDir);

  assert.match(
    await readProjectFile("README.md"),
    new RegExp(
      `^# Mine\\n\\n${MANAGED_BLOCK_START}\\n[^]*${MANAGED_BLOCK_END}\\n$`
    )
  );
});

test("upgrade fails a file with malformed markers, leaves it as is, and still upgrades the others", async () => {
  const malformedContent = `# Mine\n\n${MANAGED_BLOCK_START}\nNo end.\n`;
  await writeFile(path.join(rootDir, "AGENTS.md"), malformedContent, "utf8");

  const results = await upgradeProject(rootDir);

  assert.equal(findResult(results, "AGENTS.md").status, "failed");
  assert.match(
    findResult(results, "AGENTS.md").message,
    /Malformed tank block/
  );
  assert.equal(await readProjectFile("AGENTS.md"), malformedContent);
  assert.equal(findResult(results, "README.md").status, "success");
  assert.equal(findResult(results, "tank.env").status, "success");
});

test("upgrade appends only the domain variables tank.env doesn't mention, even commented out", async () => {
  const content = "# Mine.\n# CONFLUENCE_SPACE_ID=123\n";
  await writeFile(path.join(rootDir, "tank.env"), content, "utf8");

  const parentVariable = CONFLUENCE_TOOL.domainVariables.find(
    (variable) => variable.name === "CONFLUENCE_PARENT_ID"
  );

  await upgradeProject(rootDir);

  assert.equal(
    await readProjectFile("tank.env"),
    `${content}\n# ${parentVariable.description}\nCONFLUENCE_PARENT_ID=\n`
  );
});

test("runMigrations runs only the migrations the project needs, in order", async () => {
  const ranMigrations = [];
  const buildMigration = (name, isNeeded) => ({
    name,
    isNeeded: async () => isNeeded,
    run: async () => {
      ranMigrations.push(name);
    },
  });

  const results = await runMigrations(rootDir, "upgrade", [
    buildMigration("first", true),
    buildMigration("second", false),
    buildMigration("third", true),
  ]);

  assert.deepEqual(ranMigrations, ["first", "third"]);
  assert.deepEqual(
    results.map((result) => result.message),
    ['Ran migration "first".', 'Ran migration "third".']
  );
});

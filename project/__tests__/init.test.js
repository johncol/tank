import { after, before, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { initProject } from "../init.js";

const TANK_BIN_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "bin",
  "tank.js"
);

/**
 * Isolates git from the user's config (identity, signing, hooks), so
 * commits work the same on every machine.
 */
const GIT_ENVIRONMENT = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Tank Test",
  GIT_AUTHOR_EMAIL: "tank-test@example.com",
  GIT_COMMITTER_NAME: "Tank Test",
  GIT_COMMITTER_EMAIL: "tank-test@example.com",
};

const PROJECT_FILES = [
  ".gitignore",
  "AGENTS.md",
  "README.md",
  "confluence/sync-manifest.yaml",
  "datadog/sync-manifest.yaml",
  "tank.env",
];

let previousEnvironment;
let rootDir;

before(() => {
  previousEnvironment = Object.fromEntries(
    Object.keys(GIT_ENVIRONMENT).map((name) => [name, process.env[name]])
  );
  Object.assign(process.env, GIT_ENVIRONMENT);
});

after(() => {
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), "tank-init-"));
});

afterEach(() => rm(rootDir, { recursive: true, force: true }));

function git(...gitArguments) {
  return execFileSync("git", gitArguments, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function listLines(output) {
  return output.split("\n").filter((line) => line !== "");
}

function listCommittedFiles() {
  return listLines(git("show", "--name-only", "--format=", "HEAD")).sort();
}

test("init makes an empty folder a git repository with one commit of the project files", async () => {
  const results = await initProject(rootDir);

  assert.deepEqual(
    results.filter((result) => result.status !== "success"),
    []
  );
  assert.equal(git("rev-list", "--count", "HEAD").trim(), "1");
  assert.deepEqual(listCommittedFiles(), PROJECT_FILES);
  assert.equal(git("status", "--porcelain"), "");
});

function runTankInit() {
  return spawnSync(process.execPath, [TANK_BIN_PATH, "init"], {
    cwd: rootDir,
    encoding: "utf8",
  });
}

test("tank init prints the banner to stderr only when it succeeds, uncolored off a terminal", () => {
  const firstRun = runTankInit();

  assert.equal(JSON.parse(firstRun.stdout).ok, true);
  assert.match(firstRun.stderr, /T A N K {3}░▒▓ {3}project initialized/);
  assert.equal(firstRun.stderr.includes("\x1b["), false);

  const secondRun = runTankInit();

  assert.equal(JSON.parse(secondRun.stdout).ok, false);
  assert.doesNotMatch(secondRun.stderr, /T A N K/);
});

test("init refuses a folder that has tank.env, without writing anything", async () => {
  await writeFile(path.join(rootDir, "tank.env"), "", "utf8");

  await assert.rejects(
    initProject(rootDir),
    /tank\.env already exists.*"tank upgrade"/
  );
  assert.equal(existsSync(path.join(rootDir, ".gitignore")), false);
  assert.equal(existsSync(path.join(rootDir, ".git")), false);
});

test("init refuses a folder that has a tool's manifest, without writing anything", async () => {
  await mkdir(path.join(rootDir, "datadog"));
  await writeFile(
    path.join(rootDir, "datadog", "sync-manifest.yaml"),
    "",
    "utf8"
  );

  await assert.rejects(
    initProject(rootDir),
    /datadog\/sync-manifest\.yaml already exists/
  );
  assert.equal(existsSync(path.join(rootDir, "tank.env")), false);
  assert.equal(existsSync(path.join(rootDir, ".git")), false);
});

test("init in an existing repository commits only its files, and keeps what was staged", async () => {
  git("init");
  await writeFile(
    path.join(rootDir, ".gitignore"),
    "node_modules/\n.env",
    "utf8"
  );
  await writeFile(path.join(rootDir, "notes.md"), "In progress.\n", "utf8");
  git("add", "notes.md");

  await initProject(rootDir);

  assert.deepEqual(listCommittedFiles(), PROJECT_FILES);
  assert.deepEqual(listLines(git("diff", "--cached", "--name-only")), [
    "notes.md",
  ]);
  assert.equal(
    await readFile(path.join(rootDir, ".gitignore"), "utf8"),
    "node_modules/\n.env\n.DS_Store\n"
  );
});

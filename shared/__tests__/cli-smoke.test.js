import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

/**
 * Spawns "tank <tool>" with invalid flags only, from an empty project, so
 * every case fails validation before the manifest, the credentials, or the
 * network are touched.
 */
const TANK_BIN_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "bin",
  "tank.js"
);

let projectDir;

before(async () => {
  projectDir = await mkdtemp(path.join(os.tmpdir(), "tank-smoke-"));
  await writeFile(path.join(projectDir, "tank.env"), "", "utf8");
});

after(() => rm(projectDir, { recursive: true, force: true }));

function runTool(tool, argumentsList, cwd = projectDir) {
  const result = spawnSync(
    process.execPath,
    [TANK_BIN_PATH, tool, ...argumentsList],
    // Blank credentials, so even a validation bug can't reach a real API.
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        DATADOG_API_KEY: "",
        DATADOG_APP_KEY: "",
        CONFLUENCE_API_TOKEN: "",
      },
    }
  );

  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const INVALID_COMMANDS = [
  ["datadog", [], "no action"],
  ["confluence", [], "no action"],
  ["datadog", ["--dashboards", "--pull", "--push"], "two actions"],
  ["confluence", ["--pull", "--fetch"], "two actions"],
  ["datadog", ["--dashboards", "--pull", "--verbose"], "an unknown flag"],
  ["confluence", ["--pull", "--verbose"], "an unknown flag"],
  [
    "datadog",
    ["--dashboards", "--pull", "--id=1", "--name=a"],
    "--id with --name",
  ],
  ["confluence", ["--push", "--id=1", "--name=a"], "--id with --name"],
  [
    "datadog",
    ["--synthetic-tests", "--fetch", "--id=a", "--file-name=b"],
    "--file-name on a kind that doesn't allow it",
  ],
  [
    "datadog",
    ["--dashboards", "--pull", "--file-name=b"],
    "--file-name with --pull",
  ],
  ["confluence", ["--pull", "--file-name=b"], "--file-name with --pull"],
  [
    "datadog",
    ["--log-metrics", "--create", "--id=a", "--force"],
    "--force with --create",
  ],
  ["datadog", ["--log-metrics", "--create"], "--create without --id"],
  ["datadog", ["--log-metrics", "--delete"], "--delete without a selector"],
  ["datadog", ["--dashboards", "--create", "--id=a"], "--create on dashboards"],
  ["confluence", ["--delete", "--id=1"], "--delete on Confluence"],
];

describe("CLI smoke tests (invalid flags)", () => {
  for (const [tool, argumentsList, description] of INVALID_COMMANDS) {
    test(`${tool} rejects ${description}`, () => {
      const { exitCode, stdout, stderr } = runTool(tool, argumentsList);
      const summary = JSON.parse(stdout);

      assert.equal(exitCode, 1);
      assert.equal(summary.ok, false);
      assert.equal(typeof summary.error, "string");
      assert.deepEqual(summary.results, []);
      assert.match(stderr, new RegExp(`Usage: tank ${tool}`));
    });
  }
});

describe("CLI smoke tests (outside a project root)", () => {
  test("a tool command refuses to run without tank.env", async () => {
    const emptyDir = await mkdtemp(path.join(os.tmpdir(), "tank-smoke-"));

    try {
      const { exitCode, stdout } = runTool(
        "datadog",
        ["--dashboards", "--pull"],
        emptyDir
      );
      const summary = JSON.parse(stdout);

      assert.equal(exitCode, 1);
      assert.equal(summary.ok, false);
      assert.match(summary.error, /Not a tank project/);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  test("a tool command refuses a tank.env holding a credential", async () => {
    await writeFile(
      path.join(projectDir, "tank.env"),
      "DATADOG_API_KEY=x\n",
      "utf8"
    );

    try {
      const { exitCode, stdout } = runTool("datadog", [
        "--dashboards",
        "--pull",
      ]);
      const summary = JSON.parse(stdout);

      assert.equal(exitCode, 1);
      assert.match(summary.error, /tank\.env sets DATADOG_API_KEY/);
    } finally {
      await writeFile(path.join(projectDir, "tank.env"), "", "utf8");
    }
  });
});

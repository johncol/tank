import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadUserEnvironment } from "../config.js";

describe("loadUserEnvironment", () => {
  /** @type {string} */
  let directory;
  /** @type {string} */
  let envPath;

  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "tank-config-"));
    envPath = path.join(directory, ".env");
    process.env.TANK_TEST_PRESET = "from-environment";
    await writeFile(
      envPath,
      "TANK_TEST_LOADED=from-file\nTANK_TEST_PRESET=from-file\n"
    );
  });

  after(async () => {
    delete process.env.TANK_TEST_LOADED;
    delete process.env.TANK_TEST_PRESET;
    await rm(directory, { recursive: true, force: true });
  });

  test("loads the file into process.env, keeping variables already set", () => {
    loadUserEnvironment(envPath);

    assert.equal(process.env.TANK_TEST_LOADED, "from-file");
    assert.equal(process.env.TANK_TEST_PRESET, "from-environment");
  });

  test("reads the file only once", async () => {
    delete process.env.TANK_TEST_LOADED;
    await writeFile(envPath, "TANK_TEST_LOADED=changed\n");

    loadUserEnvironment(envPath);

    assert.equal(process.env.TANK_TEST_LOADED, undefined);
  });
});

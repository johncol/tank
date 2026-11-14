import { describe, test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { selectEntryByName, runCli } from "../cli.js";
import { datadogTool } from "../../datadog/tool.js";
import { dashboardAdapter } from "../../datadog/lib/dashboards/adapter.js";
import { logMetricAdapter } from "../../datadog/lib/log-metrics/adapter.js";
import { syntheticTestAdapter } from "../../datadog/lib/synthetic-tests/adapter.js";
import { syntheticSuiteAdapter } from "../../datadog/lib/synthetic-suites/adapter.js";
import { parseDocument } from "yaml";
import { listManifestEntries } from "../manifest.js";

const DATADOG_KINDS = datadogTool.kinds;

// Never created: these runs fail before writing, or write nothing.
const MISSING_ROOT_DIR = path.join(os.tmpdir(), "tank-cli-test-missing");

describe("selectEntryByName", () => {
  const entries = [
    { path: "synced/dashboards/dynamic-rendering.json", id: "d-1" },
    { path: "synced/synthetics/suite-a/_suite.json", id: "s-1" },
    { path: "synced/synthetics/suite-a/home-page.json", id: "t-1" },
    { path: "synced/synthetics/suite-b/home-page.json", id: "t-2" },
    { path: "synced/synthetics/suite-b/content-page.json", id: "t-3" },
    { path: "synced/log-metrics/mrt.ssr.isbot.true.json", id: "m-1" },
  ];

  test("matches the file name with or without its extension by default", () => {
    assert.equal(
      selectEntryByName(dashboardAdapter, entries, "dynamic-rendering").entry
        ?.id,
      "d-1"
    );
    assert.equal(
      selectEntryByName(dashboardAdapter, entries, "dynamic-rendering.json")
        .entry?.id,
      "d-1"
    );
  });

  test("matches a log metric by its ID, which contains dots", () => {
    assert.equal(
      selectEntryByName(logMetricAdapter, entries, "mrt.ssr.isbot.true").entry
        ?.id,
      "m-1"
    );
  });

  test("matches a synthetic suite by its folder name, with or without a trailing slash", () => {
    const suiteEntries = entries.filter((entry) => entry.id === "s-1");

    assert.equal(
      selectEntryByName(syntheticSuiteAdapter, suiteEntries, "suite-a").entry
        ?.id,
      "s-1"
    );
    assert.equal(
      selectEntryByName(syntheticSuiteAdapter, suiteEntries, "suite-a/").entry
        ?.id,
      "s-1"
    );
  });

  test("fails when a synthetic test name matches more than one entry, listing their paths", () => {
    const testEntries = entries.filter((entry) => entry.id.startsWith("t-"));
    const selection = selectEntryByName(
      syntheticTestAdapter,
      testEntries,
      "home-page"
    );

    assert.equal(selection.entry, undefined);
    assert.match(selection.message ?? "", /more than one/);
    assert.match(
      selection.message ?? "",
      /suite-a\/home-page\.json, synced\/synthetics\/suite-b\/home-page\.json/
    );
  });

  test("fails when no entry matches", () => {
    const selection = selectEntryByName(dashboardAdapter, entries, "unknown");

    assert.equal(selection.entry, undefined);
    assert.match(selection.message ?? "", /No sync-manifest.yaml entry found/);
  });
});

describe("runCli", () => {
  afterEach(() => {
    process.exitCode = 0;
    mock.restoreAll();
  });

  function silenceOutput() {
    mock.method(console, "log", () => {});
    mock.method(console, "error", () => {});
  }

  test("runs the adapter in rootDir, on the manifest there", async () => {
    silenceOutput();
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "tank-cli-test-"));
    const manifestPath = path.join(rootDir, "sync-manifest.yaml");

    try {
      await writeFile(manifestPath, "# Header.\n", "utf8");

      const summary = await runCli({
        kinds: DATADOG_KINDS,
        command: "tank test",
        rootDir,
        argv: ["--dashboards", "--fetch", "--id=abc-123"],
        createClient: () => ({
          getDashboard: async (id) => ({
            id,
            title: "Home",
            modified_at: "2026-01-01T00:00:00.000Z",
            widgets: [],
          }),
        }),
      });

      assert.equal(summary.ok, true, summary.results[0]?.message);
      const { path: artifactPath } = summary.results[0];
      await readFile(path.join(rootDir, artifactPath), "utf8");
      assert.match(
        await readFile(manifestPath, "utf8"),
        new RegExp(`^# Header\\.\\n+${artifactPath}:`)
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("fails an untracked --name without creating the client", async () => {
    silenceOutput();
    const createClient = mock.fn();
    const saveManifest = mock.fn(async () => {});

    const summary = await runCli({
      kinds: DATADOG_KINDS,
      command: "tank test",
      rootDir: MISSING_ROOT_DIR,
      argv: ["--dashboards", "--pull", "--name=unknown"],
      createClient,
      loadManifest: async () => ({ document: null, entries: [] }),
      saveManifest,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.failed, 1);
    assert.match(summary.results[0].message, /--name=unknown/);
    assert.equal(createClient.mock.callCount(), 0);
    assert.equal(saveManifest.mock.callCount(), 0);
    assert.equal(process.exitCode, 1);
  });

  test("fails an untracked parent on --create without creating the client", async () => {
    silenceOutput();
    const createClient = mock.fn();

    const summary = await runCli({
      kinds: DATADOG_KINDS,
      command: "tank test",
      rootDir: MISSING_ROOT_DIR,
      argv: [
        "--synthetic-tests",
        "--create",
        "--file-name=my-test",
        "--suite=unknown",
      ],
      createClient,
      loadManifest: async () => ({ document: null, entries: [] }),
      saveManifest: async () => {},
    });

    assert.equal(summary.failed, 1);
    assert.match(summary.results[0].message, /--suite: .*--name=unknown/);
    assert.equal(createClient.mock.callCount(), 0);
  });

  test("keeps the results gathered so far when saving the manifest fails", async () => {
    silenceOutput();
    const document = parseDocument(
      'missing-dashboard.json:\n  kind: "dashboard"\n  id: "abc-123"\n'
    );

    const summary = await runCli({
      kinds: DATADOG_KINDS,
      command: "tank test",
      rootDir: MISSING_ROOT_DIR,
      argv: ["--dashboards", "--push"],
      createClient: () => ({}),
      loadManifest: async () => ({
        document,
        entries: listManifestEntries(document),
      }),
      saveManifest: async () => {
        throw new Error("Document with errors cannot be stringified");
      },
    });

    assert.equal(summary.ok, false);
    assert.match(summary.error ?? "", /Couldn't save the manifest: Document/);
    assert.equal(summary.total, 1);
    assert.equal(summary.results[0].path, "missing-dashboard.json");
    assert.equal(process.exitCode, 1);
  });

  test("passes the follow-up kind's adapter, in rootDir, to afterFetch", async () => {
    silenceOutput();
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "tank-cli-test-"));

    try {
      await writeFile(path.join(rootDir, "sync-manifest.yaml"), "", "utf8");

      const summary = await runCli({
        kinds: DATADOG_KINDS,
        command: "tank test",
        rootDir,
        argv: ["--synthetic-suites", "--fetch", "--id=s-1"],
        createClient: () => ({
          getSyntheticSuite: async (id) => ({
            public_id: id,
            name: "Checkout",
            tests: [{ public_id: "t-1" }],
            modified_at: "2026-01-01T00:00:00.000Z",
          }),
          getSyntheticTest: async (id) => ({
            public_id: id,
            name: "Home page",
            type: "api",
            modified_at: "2026-01-01T00:00:00.000Z",
          }),
          getSyntheticTestParentSuites: async () => [
            { public_id: "s-1", name: "Checkout" },
          ],
        }),
      });

      assert.equal(summary.ok, true, JSON.stringify(summary.results));
      const testResult = summary.results[1];

      assert.equal(testResult.kind, "synthetic-test");
      await readFile(path.join(rootDir, testResult.path), "utf8");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("saves the manifest after each artifact of a bulk run", async () => {
    silenceOutput();
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "tank-cli-test-"));
    const document = parseDocument(
      'first.json:\n  kind: "dashboard"\n  id: "first"\n  remoteVersion: "old"\n' +
        'second.json:\n  kind: "dashboard"\n  id: "second"\n  remoteVersion: "old"\n'
    );
    const savedManifests = [];

    try {
      await runCli({
        kinds: DATADOG_KINDS,
        command: "tank test",
        rootDir,
        argv: ["--dashboards", "--pull"],
        createClient: () => ({
          getDashboard: async (id) => ({ id, title: id, modified_at: "new" }),
        }),
        loadManifest: async () => ({
          document,
          entries: listManifestEntries(document),
        }),
        saveManifest: async (savedDocument) => {
          savedManifests.push(
            listManifestEntries(parseDocument(String(savedDocument)))
          );
        },
      });

      const versionsAfterFirstSave = savedManifests[0].map(
        (entry) => entry.remoteVersion
      );

      assert.deepEqual(versionsAfterFirstSave, ["new", "old"]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("asks to run tank upgrade when the tool's manifest is missing, without creating the client", async () => {
    silenceOutput();
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "tank-cli-test-"));
    const toolDir = path.join(rootDir, "datadog");
    const createClient = mock.fn();

    try {
      const summary = await runCli({
        kinds: DATADOG_KINDS,
        command: "tank test",
        rootDir: toolDir,
        argv: ["--dashboards", "--pull"],
        createClient,
      });

      assert.equal(summary.ok, false);
      assert.equal(
        summary.error,
        'datadog/sync-manifest.yaml is missing. Run "tank upgrade" to create it, then run this command again.'
      );
      assert.equal(createClient.mock.callCount(), 0);
      assert.equal(process.exitCode, 1);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("reports an unexpected error in the summary", async () => {
    silenceOutput();

    const summary = await runCli({
      kinds: DATADOG_KINDS,
      command: "tank test",
      rootDir: MISSING_ROOT_DIR,
      argv: ["--dashboards", "--pull"],
      createClient: () => {
        throw new Error("Missing required environment variable(s)");
      },
      loadManifest: async () => ({ document: null, entries: [] }),
      saveManifest: async () => {},
    });

    assert.equal(summary.ok, false);
    assert.match(summary.error ?? "", /Missing required environment/);
    assert.equal(process.exitCode, 1);
  });
});

import { describe, test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseCliArguments,
  selectEntryByName,
  buildSummary,
  buildUsage,
  runCli,
  UsageError,
} from "../cli.js";
import { datadogTool } from "../../datadog/tool.js";
import { confluenceTool } from "../../confluence/tool.js";
import { dashboardAdapter } from "../../datadog/lib/dashboards/adapter.js";
import { logMetricAdapter } from "../../datadog/lib/log-metrics/adapter.js";
import { syntheticTestAdapter } from "../../datadog/lib/synthetic-tests/adapter.js";
import { syntheticSuiteAdapter } from "../../datadog/lib/synthetic-suites/adapter.js";
import { pageAdapter } from "../../confluence/lib/pages/adapter.js";
import { parseDocument } from "yaml";
import { listManifestEntries } from "../manifest.js";

const DATADOG_KINDS = datadogTool.kinds;
const CONFLUENCE_KINDS = confluenceTool.kinds;

// Never created: these runs fail before writing, or write nothing.
const MISSING_ROOT_DIR = path.join(os.tmpdir(), "tank-cli-test-missing");

function parseDatadog(argumentsText) {
  return parseCliArguments(argumentsText.split(" "), DATADOG_KINDS);
}

function parseConfluence(argumentsText) {
  return parseCliArguments(argumentsText.split(" "), CONFLUENCE_KINDS);
}

describe("parseCliArguments", () => {
  test("parses a valid Datadog command into the selected adapter and flags", () => {
    const options = parseDatadog(
      "--dashboards --fetch --id=abc-123 --file-name=my-dashboard --force"
    );

    assert.equal(options.adapter, dashboardAdapter);
    assert.equal(options.action, "fetch");
    assert.equal(options.id, "abc-123");
    assert.equal(options.fileName, "my-dashboard");
    assert.equal(options.force, true);
  });

  test("defaults to a single-kind tool's only kind, and accepts its kind flag", () => {
    assert.equal(parseConfluence("--pull").adapter, pageAdapter);
    assert.equal(parseConfluence("--pages --pull").adapter, pageAdapter);
  });

  test("allows --pull and --push without a selector", () => {
    assert.equal(parseDatadog("--log-metrics --pull").id, undefined);
    assert.equal(parseConfluence("--push").name, undefined);
  });

  test("allows --name on pull, push, and delete", () => {
    assert.equal(
      parseDatadog("--synthetic-tests --delete --name=my-test").name,
      "my-test"
    );
    assert.equal(
      parseConfluence("--push --name=datadog.md").name,
      "datadog.md"
    );
  });

  test("takes a file name and an optional parent on --create when the remote assigns the ID", () => {
    const options = parseDatadog(
      "--synthetic-tests --create --file-name=my-test --suite=my-suite"
    );

    assert.equal(options.adapter, syntheticTestAdapter);
    assert.equal(options.fileName, "my-test");
    assert.equal(options.parentName, "my-suite");
    assert.equal(
      parseDatadog("--synthetic-tests --create --file-name=my-test").parentName,
      undefined
    );
  });

  const invalidCommands = [
    ["--dashboards", "no action", /exactly one action flag/],
    ["--dashboards --pull --push", "two actions", /exactly one action flag/],
    ["--pull", "no kind on a multi-kind tool", /exactly one kind flag/],
    ["--dashboards --log-metrics --pull", "two kinds", /exactly one kind flag/],
    ["--dashboards --pull --verbose", "an unknown flag", /Unknown option/],
    ["--dashboards --pull extra", "a positional argument", /positional/],
    [
      "--dashboards --pull --id=1 --name=a",
      "--id with --name",
      /either --id or --name/,
    ],
    [
      "--log-metrics --fetch --id=a --file-name=b",
      "--file-name on a kind that doesn't allow it",
      /--file-name isn't supported with --log-metrics/,
    ],
    [
      "--dashboards --pull --file-name=b",
      "--file-name with --pull",
      /only accepted with --fetch/,
    ],
    [
      "--log-metrics --create --id=a --force",
      "--force with --create",
      /--force isn't accepted with --create/,
    ],
    ["--log-metrics --create", "--create without --id", /requires --id/],
    ["--dashboards --fetch", "--fetch without --id", /requires --id/],
    ["--dashboards --fetch --id=", "an empty --id", /--id needs a value/],
    ["--dashboards --pull --name=", "an empty --name", /--name needs a value/],
    [
      "--dashboards --fetch --name=a",
      "--name on --fetch",
      /only selects a tracked artifact.*--file-name/,
    ],
    [
      "--synthetic-tests --delete",
      "--delete without a selector",
      /requires --id or --name/,
    ],
    [
      "--dashboards --create --id=a",
      "an action the kind doesn't support",
      /--create isn't supported with --dashboards/,
    ],
    [
      "--log-metrics --create --id=a --file-name=b",
      "--file-name on --create when the ID is chosen",
      /file name comes from --id/,
    ],
    [
      "--synthetic-tests --create --id=a --file-name=b",
      "--id on --create when the remote assigns the ID",
      /doesn't take --id or --name/,
    ],
    [
      "--synthetic-tests --create",
      "--create without --file-name when the remote assigns the ID",
      /requires --file-name/,
    ],
    [
      "--synthetic-tests --pull --suite=a",
      "a parent flag on another action",
      /--suite is only accepted with --create/,
    ],
    [
      "--log-metrics --create --id=a --suite=b",
      "a parent flag on a kind without that parent",
      /--suite is only accepted with --create/,
    ],
    [
      "--synthetic-tests --create --file-name=a --suite=",
      "an empty parent flag",
      /--suite needs a value/,
    ],
  ];

  for (const [argumentsText, description, expectedMessage] of invalidCommands) {
    test(`rejects ${description}`, () => {
      assert.throws(
        () => parseDatadog(argumentsText),
        (error) =>
          error instanceof UsageError && expectedMessage.test(error.message)
      );
    });
  }

  test("rejects an action the single Confluence kind doesn't support", () => {
    assert.throws(
      () => parseConfluence("--delete --id=1"),
      /--delete isn't supported with --pages/
    );
  });
});

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

describe("buildSummary", () => {
  test("counts results and is ok only when nothing failed", () => {
    const summary = buildSummary([
      { status: "success" },
      { status: "skipped" },
      { status: "failed" },
    ]);

    assert.deepEqual(
      { ...summary, results: undefined },
      {
        ok: false,
        total: 3,
        succeeded: 1,
        skipped: 1,
        failed: 1,
        results: undefined,
      }
    );
  });

  test("is not ok when the run stopped with an error", () => {
    const summary = buildSummary([], "Pass exactly one action flag.");

    assert.equal(summary.ok, false);
    assert.equal(summary.error, "Pass exactly one action flag.");
  });
});

describe("buildUsage", () => {
  const readOnlyAdapter = {
    kind: "widget",
    systemName: "Remote",
    actions: ["fetch", "pull"],
    allowsFileName: false,
  };
  const creatableAdapter = {
    kind: "gadget",
    systemName: "Remote",
    actions: ["fetch", "pull", "push", "create", "delete"],
    allowsFileName: true,
    assignsIdOnCreate: true,
    parent: { flag: "box", kind: "widget" },
    usageNote: "Gadgets live in boxes.",
  };

  function findKindLines(usage, flag) {
    const lines = usage.split("\n");
    const start = lines.findIndex((line) => line.startsWith(`  --${flag} `));
    const end = lines.findIndex(
      (line, index) => index > start && !line.startsWith(" ".repeat(24))
    );

    return lines.slice(start, end).join(" ");
  }

  test("describes each kind from its adapter's capabilities", () => {
    const usage = buildUsage({
      command: "tank gizmo",
      kinds: {
        widget: { flag: "widgets", adapter: readOnlyAdapter },
        gadget: { flag: "gadgets", adapter: creatableAdapter },
      },
    });
    const widgetLines = findKindLines(usage, "widgets");
    const gadgetLines = findKindLines(usage, "gadgets");

    assert.match(
      usage,
      /^Usage: tank gizmo <kind> <action> .*\[--box=<name>\]/
    );
    assert.match(widgetLines, /actions: --fetch, --pull$/);
    assert.doesNotMatch(widgetLines, /--file-name|--create/);
    assert.match(
      gadgetLines,
      /actions: --fetch, --pull, --push, --create, --delete/
    );
    assert.match(gadgetLines, /--fetch takes --file-name/);
    assert.match(
      gadgetLines,
      /--create requires --file-name, since Remote assigns/
    );
    assert.match(gadgetLines, /--box/);
    assert.match(gadgetLines, /Gadgets live in boxes\./);
    assert.match(usage, /--delete always needs --id or --name\./);
  });

  test("leaves out flags and actions no kind supports", () => {
    const usage = buildUsage({
      command: "tank gizmo",
      kinds: { widget: { flag: "widgets", adapter: readOnlyAdapter } },
    });

    assert.match(usage, /^Usage: tank gizmo \[--widgets\] <action>/);
    assert.match(usage, /Kind \(optional/);
    assert.match(usage, /Action \(exactly one\): --fetch, --pull\n/);
    assert.doesNotMatch(usage, /--file-name|--create|--delete|--box/);
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

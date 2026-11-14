import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseCliArguments, UsageError } from "../cli-arguments.js";
import { datadogTool } from "../../datadog/tool.js";
import { confluenceTool } from "../../confluence/tool.js";
import { dashboardAdapter } from "../../datadog/lib/dashboards/adapter.js";
import { syntheticTestAdapter } from "../../datadog/lib/synthetic-tests/adapter.js";
import { pageAdapter } from "../../confluence/lib/pages/adapter.js";

const DATADOG_KINDS = datadogTool.kinds;
const CONFLUENCE_KINDS = confluenceTool.kinds;

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
      "--synthetic-suites --create --file-name=a",
      "an action the kind doesn't support",
      /--create isn't supported with --synthetic-suites/,
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
});

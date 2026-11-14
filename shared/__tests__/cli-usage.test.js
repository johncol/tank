import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildUsage } from "../cli-usage.js";

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

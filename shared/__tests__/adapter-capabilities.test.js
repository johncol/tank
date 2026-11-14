import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../../project/tools.js";
import { findCapabilityProblems } from "../adapter-capabilities.js";

const COMPLETE_ADAPTER = {
  kind: "widget",
  actions: ["fetch", "create", "delete"],
  allowsFileName: true,
  fileNameSuffix: ".json",
  buildCreatePath: () => "synced/widget.json",
  createRemote: async () => ({}),
  assignsIdOnCreate: true,
  findRemoteIdByContent: async () => null,
  getCreatedId: () => "1",
  deleteRemote: async () => {},
};

test("every registered tool's adapters declare the capabilities they need", () => {
  for (const tool of TOOLS) {
    assert.deepEqual(findCapabilityProblems(tool.kinds), [], tool.name);
  }
});

test("reports each capability another capability requires", () => {
  const adapter = {
    ...COMPLETE_ADAPTER,
    buildCreatePath: undefined,
    deleteRemote: undefined,
    fileNameSuffix: undefined,
    getCreatedId: undefined,
  };

  assert.deepEqual(
    findCapabilityProblems({ widget: { flag: "widgets", adapter } }),
    [
      'widget: the "create" action requires "buildCreatePath".',
      'widget: the "delete" action requires "deleteRemote".',
      'widget: "allowsFileName" requires "fileNameSuffix".',
      'widget: "assignsIdOnCreate" requires "fileNameSuffix".',
      'widget: "assignsIdOnCreate" requires "getCreatedId".',
    ]
  );
});

test("reports a kind key that doesn't match the adapter's kind", () => {
  assert.deepEqual(
    findCapabilityProblems({
      gadget: { flag: "gadgets", adapter: COMPLETE_ADAPTER },
    }),
    [
      'gadget: is registered under "gadget" but its adapter\'s kind is "widget".',
    ]
  );
});

test("reports a parent kind the tool doesn't have", () => {
  const adapter = { ...COMPLETE_ADAPTER, parent: { kind: "board" } };

  assert.deepEqual(
    findCapabilityProblems({ widget: { flag: "widgets", adapter } }),
    ["widget: its parent kind \"board\" isn't one of the tool's kinds."]
  );
});

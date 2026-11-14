/**
 * Checks that a tool's adapters declare every capability their other
 * capabilities depend on (see the `Adapter` typedef in shared/actions.js),
 * so a missing one fails when the tool runs, not halfway through an action.
 */

/**
 * @param {Object<string, import("./cli-arguments.js").KindDefinition>} kinds
 *   The tool's kinds, keyed by manifest `kind`.
 * @returns {string[]} One message per missing or inconsistent capability.
 */
export function findCapabilityProblems(kinds) {
  const problems = [];

  for (const [kind, { adapter }] of Object.entries(kinds)) {
    const requireCapabilities = (reason, capabilityNames) => {
      for (const capabilityName of capabilityNames) {
        if (!adapter[capabilityName]) {
          problems.push(`${kind}: ${reason} requires "${capabilityName}".`);
        }
      }
    };

    if (adapter.kind !== kind) {
      problems.push(
        `${kind}: is registered under "${kind}" but its adapter's kind is "${adapter.kind}".`
      );
    }

    if (adapter.actions.includes("create")) {
      requireCapabilities('the "create" action', [
        "buildCreatePath",
        "createRemote",
      ]);
    }

    if (adapter.actions.includes("delete")) {
      requireCapabilities('the "delete" action', ["deleteRemote"]);
    }

    if (adapter.allowsFileName) {
      requireCapabilities('"allowsFileName"', ["fileNameSuffix"]);
    }

    if (adapter.assignsIdOnCreate) {
      requireCapabilities('"assignsIdOnCreate"', [
        "fileNameSuffix",
        "findRemoteIdByContent",
        "getCreatedId",
      ]);
    }

    if (adapter.afterFetch || adapter.afterPull) {
      requireCapabilities('"afterFetch" or "afterPull"', ["followUpKind"]);
    }

    if (adapter.followUpKind && !kinds[adapter.followUpKind]) {
      problems.push(
        `${kind}: its follow-up kind "${adapter.followUpKind}" isn't one of the tool's kinds.`
      );
    }

    if (adapter.parent && !kinds[adapter.parent.kind]) {
      problems.push(
        `${kind}: its parent kind "${adapter.parent.kind}" isn't one of the tool's kinds.`
      );
    }
  }

  return problems;
}

/**
 * @param {Object<string, import("./cli-arguments.js").KindDefinition>} kinds
 * @throws {Error} When `findCapabilityProblems` finds any problem.
 */
export function assertValidCapabilities(kinds) {
  const problems = findCapabilityProblems(kinds);

  if (problems.length > 0) {
    throw new Error(
      `Invalid adapter capabilities:\n${problems.map((problem) => `- ${problem}`).join("\n")}`
    );
  }
}

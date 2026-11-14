import { parseArgs } from "node:util";
import { getErrorMessage } from "./error.js";

/**
 * Parses and validates a sync tool's command-line arguments against its
 * kinds' adapter capabilities (CONVENTIONS.md "Flags").
 *
 * @typedef {import("./actions.js").Action} Action
 * @typedef {import("./actions.js").AdapterDefinition} AdapterDefinition
 *
 * @typedef {Object} KindDefinition
 * @property {string} flag The kind flag, without the leading dashes (e.g.
 *   "dashboards").
 * @property {AdapterDefinition} adapter
 *
 * @typedef {Object} CliOptions
 * @property {Action} action
 * @property {AdapterDefinition} adapter
 * @property {string} [id]
 * @property {string} [name]
 * @property {string} [fileName]
 * @property {string} [parentName] The parent flag's value, with --create.
 * @property {boolean} force
 */

/** @type {Action[]} */
export const ACTIONS = ["fetch", "pull", "push", "create", "delete"];

/** Actions that start tracking an artifact, so they need its remote ID,
 * unless the remote assigns it on create. */
export const ACTIONS_NEEDING_ID = ["fetch", "create"];

/** Actions that may run on every tracked artifact when no selector is given. */
export const ACTIONS_ALLOWING_ALL_ENTRIES = ["pull", "push"];

/** An invalid command line. Its message is reported with the usage text. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * Parses and validates a tool's command-line arguments against the tool's
 * kinds. A tool with several kinds requires exactly one kind flag; a tool
 * with a single kind accepts its kind flag but doesn't require it.
 *
 * @param {string[]} argv The arguments after the script path.
 * @param {Object<string, KindDefinition>} kinds The tool's kinds, keyed by
 *   manifest `kind`.
 * @returns {CliOptions}
 * @throws {UsageError} When the arguments break a rule in CONVENTIONS.md.
 */
export function parseCliArguments(argv, kinds) {
  const kindDefinitions = Object.values(kinds);
  const options = {
    id: { type: "string" },
    name: { type: "string" },
    "file-name": { type: "string" },
    force: { type: "boolean", default: false },
  };

  for (const action of ACTIONS) {
    options[action] = { type: "boolean", default: false };
  }

  for (const { flag } of kindDefinitions) {
    options[flag] = { type: "boolean", default: false };
  }

  const parentFlags = listParentFlags(kindDefinitions);

  for (const parentFlag of parentFlags) {
    options[parentFlag] = { type: "string" };
  }

  let values;

  try {
    ({ values } = parseArgs({
      args: argv,
      options: /** @type {any} */ (options),
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(getErrorMessage(error));
  }

  const adapter = selectAdapter(values, kindDefinitions);
  const kindFlag = kindDefinitions.find(
    (definition) => definition.adapter === adapter
  )?.flag;
  const selectedActions = ACTIONS.filter((action) => values[action]);

  if (selectedActions.length !== 1) {
    throw new UsageError(
      `Pass exactly one action flag (${formatFlags(adapter.actions)}).`
    );
  }

  const [action] = selectedActions;
  const id = /** @type {string | undefined} */ (values.id);
  const name = /** @type {string | undefined} */ (values.name);
  const fileName = /** @type {string | undefined} */ (values["file-name"]);
  const force = Boolean(values.force);
  const passedParentFlags = parentFlags.filter(
    (parentFlag) => values[parentFlag] !== undefined
  );
  const assignsId = action === "create" && Boolean(adapter.assignsIdOnCreate);

  for (const flagName of ["id", "name", "file-name", ...parentFlags]) {
    const value = values[flagName];

    if (value !== undefined && String(value).trim() === "") {
      throw new UsageError(`--${flagName} needs a value.`);
    }
  }

  if (!adapter.actions.includes(action)) {
    throw new UsageError(
      `--${action} isn't supported with --${kindFlag}. Supported actions: ${formatFlags(adapter.actions)}.`
    );
  }

  if (id !== undefined && name !== undefined) {
    throw new UsageError("Pass either --id or --name, not both.");
  }

  if (fileName !== undefined && !assignsId) {
    if (action !== "fetch" && action !== "create") {
      throw new UsageError(
        "--file-name is only accepted with --fetch and --create."
      );
    }

    if (action === "create") {
      throw new UsageError(
        `--file-name isn't accepted with --${kindFlag} --create: the file name comes from --id.`
      );
    }

    if (!adapter.allowsFileName) {
      throw new UsageError(
        `--file-name isn't supported with --${kindFlag}: its file name isn't derived from the title.`
      );
    }
  }

  for (const parentFlag of passedParentFlags) {
    if (action !== "create" || adapter.parent?.flag !== parentFlag) {
      throw new UsageError(
        `--${parentFlag} is only accepted with --create, for kinds created inside a ${parentFlag}.`
      );
    }
  }

  if (force && action === "create") {
    throw new UsageError("--force isn't accepted with --create.");
  }

  if (assignsId) {
    if (id !== undefined || name !== undefined) {
      throw new UsageError(
        `--${kindFlag} --create doesn't take --id or --name: ${adapter.systemName} assigns the ID. Pass --file-name.`
      );
    }

    if (fileName === undefined) {
      throw new UsageError(`--${kindFlag} --create requires --file-name.`);
    }
  } else if (ACTIONS_NEEDING_ID.includes(action)) {
    if (name !== undefined) {
      let message = `--name only selects a tracked artifact, so it isn't accepted with --${action}. Pass --id.`;

      if (action === "fetch" && adapter.allowsFileName) {
        message += " To name the new file, pass --file-name.";
      }

      throw new UsageError(message);
    }

    if (id === undefined) {
      throw new UsageError(`--${action} requires --id.`);
    }
  }

  if (
    !ACTIONS_NEEDING_ID.includes(action) &&
    !ACTIONS_ALLOWING_ALL_ENTRIES.includes(action) &&
    id === undefined &&
    name === undefined
  ) {
    throw new UsageError(`--${action} requires --id or --name.`);
  }

  const parentName =
    passedParentFlags.length === 1
      ? /** @type {string} */ (values[passedParentFlags[0]])
      : undefined;

  return { action, adapter, id, name, fileName, parentName, force };
}

/** The parent flags (e.g. "suite") the tool's kinds declare for --create. */
export function listParentFlags(kindDefinitions) {
  const flags = kindDefinitions
    .map(({ adapter }) => adapter.parent?.flag)
    .filter((flag) => flag !== undefined);

  return [...new Set(flags)];
}

/** Returns the adapter of the selected kind flag, or the tool's only kind
 * when its kind flag is left out. */
function selectAdapter(values, kindDefinitions) {
  const selectedKinds = kindDefinitions.filter(
    (definition) => values[definition.flag]
  );

  if (selectedKinds.length === 1) {
    return selectedKinds[0].adapter;
  }

  if (selectedKinds.length === 0 && kindDefinitions.length === 1) {
    return kindDefinitions[0].adapter;
  }

  const kindFlags = kindDefinitions.map((definition) => definition.flag);

  throw new UsageError(
    `Pass exactly one kind flag (${formatFlags(kindFlags)}).`
  );
}

/**
 * Formats flag names as they're passed (e.g. "--fetch, --pull").
 * @param {string[]} flags Flag names, without the leading dashes.
 * @returns {string}
 */
export function formatFlags(flags) {
  return flags.map((flag) => `--${flag}`).join(", ");
}

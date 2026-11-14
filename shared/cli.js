import { parseArgs } from "node:util";
import * as actions from "./actions.js";
import { findEntryById, findEntriesByFileName } from "./manifest.js";
import { getErrorMessage } from "./error.js";

/**
 * Runs a sync tool's command line the same way for every tool and kind:
 * parses and validates the flags (CONVENTIONS.md "Flags"), dispatches to
 * the shared action engine, prints exactly one JSON summary to stdout, and
 * sets the exit code. Every kind-specific rule comes from the selected
 * kind's adapter (`actions`, `allowsFileName`, `assignsIdOnCreate`,
 * `parent`, `findEntriesByName`), never from a branch on the kind
 * here.
 *
 * @typedef {import("./actions.js").Action} Action
 * @typedef {import("./actions.js").Adapter} Adapter
 *
 * @typedef {Object} KindDefinition
 * @property {string} flag The kind flag, without the leading dashes (e.g.
 *   "dashboards").
 * @property {Adapter} adapter
 *
 * @typedef {Object} CliOptions
 * @property {Action} action
 * @property {Adapter} adapter
 * @property {string} [id]
 * @property {string} [name]
 * @property {string} [fileName]
 * @property {string} [parentName] The parent flag's value, with --create.
 * @property {boolean} force
 *
 * @typedef {Object} Summary
 * @property {boolean} ok Whether the run had no error and no failed result.
 * @property {string} [error] Why the run stopped before or while running
 *   the action (invalid flags, or an unexpected error).
 * @property {number} total
 * @property {number} succeeded
 * @property {number} skipped
 * @property {number} failed
 * @property {Object[]} results
 */

/** @type {Action[]} */
const ACTIONS = ["fetch", "pull", "push", "create", "delete"];

/** Actions that start tracking an artifact, so they need its remote ID,
 * unless the remote assigns it on create. */
const ACTIONS_NEEDING_ID = ["fetch", "create"];

/** Actions that may run on every tracked artifact when no selector is given. */
const ACTIONS_ALLOWING_ALL_ENTRIES = ["pull", "push"];

/** Flags that ask for a command's usage text instead of running it. */
const HELP_FLAGS = ["--help", "-h"];

/** An invalid command line. Its message is reported with the usage text. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/** The manifest couldn't be saved after the action ran. Carries the
 * action's results, since their remote writes already happened. */
class ManifestSaveError extends Error {
  /**
   * @param {unknown} cause
   * @param {Object[]} results
   */
  constructor(cause, results) {
    super(`Couldn't save the manifest: ${getErrorMessage(cause)}`, { cause });
    this.name = "ManifestSaveError";
    this.results = results;
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
function listParentFlags(kindDefinitions) {
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

function formatFlags(flags) {
  return flags.map((flag) => `--${flag}`).join(", ");
}

/**
 * Finds the tracked entry `--name` selects, among entries of the adapter's
 * kind. Uses the adapter's `findEntriesByName` when it has one, and
 * otherwise matches the file name, with or without its extension.
 *
 * @param {Adapter} adapter
 * @param {Object[]} kindEntries
 * @param {string} name
 * @returns {{ entry: Object | undefined, message?: string }} The entry, or
 *   the reason no single entry matched.
 */
export function selectEntryByName(adapter, kindEntries, name) {
  const matchingEntries = adapter.findEntriesByName
    ? adapter.findEntriesByName(kindEntries, name)
    : findEntriesByFileName(kindEntries, name);

  if (matchingEntries.length === 0) {
    return {
      entry: undefined,
      message: `No sync-manifest.yaml entry found for ${adapter.kind} --name=${name}.`,
    };
  }

  if (matchingEntries.length > 1) {
    const matchingPaths = matchingEntries.map((entry) => entry.path);

    return {
      entry: undefined,
      message: `--name=${name} matches more than one tracked ${adapter.kind} (${matchingPaths.join(", ")}). Use --id instead.`,
    };
  }

  return { entry: matchingEntries[0] };
}

/**
 * Builds the run's JSON summary from its results, and the error that
 * stopped it, if any.
 *
 * @param {Object[]} results
 * @param {string} [error]
 * @returns {Summary}
 */
export function buildSummary(results, error) {
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter(
    (result) => result.status === "skipped"
  ).length;

  return {
    ok: error === undefined && failed === 0,
    ...(error === undefined ? {} : { error }),
    total: results.length,
    succeeded: results.length - failed - skipped,
    skipped,
    failed,
    results,
  };
}

/**
 * Runs the selected action and returns its results.
 *
 * @param {CliOptions} options
 * @param {{ kinds: Object<string, KindDefinition>, createClient: () => any,
 *   loadManifest: () => Promise<{ document: any, entries: Object[] }>,
 *   saveManifest: (document: any) => Promise<void> }} tool
 * @returns {Promise<Object[]>}
 */
async function runAction(options, tool) {
  const { action, adapter, id, name, fileName, parentName, force } = options;
  const { document, entries } = await tool.loadManifest();
  const parentAdapter = adapter.parent
    ? /** @type {Adapter} */ (tool.kinds[adapter.parent.kind]?.adapter)
    : undefined;
  let results;

  if (action === "fetch") {
    results = await actions.fetchOne(
      adapter,
      tool.createClient(),
      document,
      /** @type {string} */ (id),
      { force, fileName }
    );
  } else if (action === "create") {
    let parent;

    if (parentName !== undefined) {
      const parentFlag = /** @type {any} */ (adapter.parent).flag;
      const selection = selectEntryByName(
        /** @type {Adapter} */ (parentAdapter),
        entries.filter((entry) => entry.kind === parentAdapter?.kind),
        parentName
      );

      if (!selection.entry) {
        return [
          actions.buildResult({
            kind: adapter.kind,
            action,
            status: "failed",
            message: `--${parentFlag}: ${selection.message}`,
          }),
        ];
      }

      parent = {
        adapter: /** @type {Adapter} */ (parentAdapter),
        entry: selection.entry,
      };
    }

    results = await actions.createOne(adapter, tool.createClient(), document, {
      id,
      fileName,
      parent,
    });
  } else {
    const actionOne = {
      pull: actions.pullOne,
      push: actions.pushOne,
      delete: actions.deleteOne,
    }[action];

    if (id === undefined && name === undefined) {
      results = await actions.runForEach(
        adapter,
        tool.createClient(),
        document,
        actionOne,
        { force }
      );
    } else {
      const kindEntries = entries.filter(
        (entry) => entry.kind === adapter.kind
      );
      const selection =
        id !== undefined
          ? {
              entry: findEntryById(kindEntries, adapter.kind, id),
              message: `No sync-manifest.yaml entry found for ${adapter.kind} ID ${id}.`,
            }
          : selectEntryByName(
              adapter,
              kindEntries,
              /** @type {string} */ (name)
            );

      if (!selection.entry) {
        return [
          actions.buildResult({
            kind: adapter.kind,
            id,
            action,
            status: "failed",
            message: selection.message,
          }),
        ];
      }

      results = await actionOne(
        adapter,
        tool.createClient(),
        document,
        selection.entry,
        { force, parentAdapter }
      );
    }
  }

  try {
    await tool.saveManifest(document);
  } catch (error) {
    throw new ManifestSaveError(error, results);
  }

  return results;
}

/**
 * Runs a sync tool's command line: validates every flag before touching the
 * manifest, the credentials, or the network, then runs the action. Prints
 * exactly one JSON summary to stdout, including on `--help` and invalid
 * flags (with the usage text on stderr) and unexpected errors, and sets the exit code to 0
 * when nothing failed, or 1 otherwise.
 *
 * @param {Object} tool
 * @param {Object<string, KindDefinition>} tool.kinds The tool's kinds,
 *   keyed by manifest `kind`.
 * @param {string} tool.usage The usage text printed on invalid flags.
 * @param {() => any} tool.createClient Creates the API client. Called only
 *   once the flags are valid, since it reads the credentials.
 * @param {() => Promise<{ document: any, entries: Object[] }>}
 *   tool.loadManifest
 * @param {(document: any) => Promise<void>} tool.saveManifest
 * @param {string[]} [tool.argv] Defaults to the process's arguments.
 * @returns {Promise<Summary>}
 */
export async function runCli({
  kinds,
  usage,
  createClient,
  loadManifest,
  saveManifest,
  argv = process.argv.slice(2),
}) {
  if (isHelpRequest(argv)) {
    return reportHelp(usage);
  }

  let summary;

  try {
    const options = parseCliArguments(argv, kinds);
    const results = await runAction(options, {
      kinds,
      createClient,
      loadManifest,
      saveManifest,
    });

    summary = buildSummary(results);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${usage}`);
    } else {
      console.error(error);
    }

    summary = buildSummary(
      error instanceof ManifestSaveError ? error.results : [],
      getErrorMessage(error)
    );
  }

  reportSummary(summary);

  return summary;
}

/**
 * Whether the command line asks for the usage text (`--help` or `-h`
 * anywhere), which every tank command handles before anything else.
 * @param {string[]} argv
 * @returns {boolean}
 */
export function isHelpRequest(argv) {
  return argv.some((argument) => HELP_FLAGS.includes(argument));
}

/**
 * Prints a command's usage text to stderr and a successful empty summary to
 * stdout, so `--help` keeps stdout to the one JSON summary.
 * @param {string} usage
 * @returns {Summary}
 */
export function reportHelp(usage) {
  const summary = buildSummary([]);

  console.error(usage);
  reportSummary(summary);

  return summary;
}

/**
 * Prints a command's one JSON summary to stdout and sets the exit code
 * from it, the same way for every tank command.
 * @param {Summary} summary
 */
export function reportSummary(summary) {
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.ok ? 0 : 1;
}

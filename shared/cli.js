import path from "node:path";
import * as actions from "./actions.js";
import { assertValidCapabilities } from "./adapter-capabilities.js";
import { UsageError, parseCliArguments } from "./cli-arguments.js";
import { buildUsage } from "./cli-usage.js";
import {
  MANIFEST_FILE_NAME,
  findEntryById,
  findEntriesByFileName,
  loadManifest as loadManifestFile,
  saveManifest as saveManifestFile,
} from "./manifest.js";
import { getProjectRoot } from "./config.js";
import { getErrorMessage } from "./error.js";
import {
  buildSummary,
  isHelpRequest,
  reportHelp,
  reportSummary,
} from "./summary.js";

/**
 * Runs a sync tool's command line the same way for every tool and kind:
 * parses and validates the flags (CONVENTIONS.md "Flags"), dispatches to
 * the shared action engine, prints exactly one JSON summary to stdout, and
 * sets the exit code. Every kind-specific rule comes from the selected
 * kind's adapter (`actions`, `allowsFileName`, `assignsIdOnCreate`,
 * `parent`, `findEntriesByName`), never from a branch on the kind
 * here.
 *
 * @typedef {import("./actions.js").Adapter} Adapter
 * @typedef {import("./actions.js").AdapterDefinition} AdapterDefinition
 * @typedef {import("./cli-arguments.js").KindDefinition} KindDefinition
 * @typedef {import("./cli-arguments.js").CliOptions} CliOptions
 * @typedef {import("./summary.js").Summary} Summary
 */

/** The tool's manifest doesn't exist, e.g. in a project initialized before
 * the tool was added to tank. Its message is reported without a stack. */
class MissingManifestError extends Error {
  /** @param {string} rootDir The tool's folder. */
  constructor(rootDir) {
    const manifestPath = `${path.basename(rootDir)}/${MANIFEST_FILE_NAME}`;

    super(
      `${manifestPath} is missing. Run "tank upgrade" to create it, then run this command again.`
    );
    this.name = "MissingManifestError";
  }
}

/**
 * Loads the manifest in the tool's folder.
 * @param {string} rootDir The tool's folder.
 * @throws {MissingManifestError} When the manifest doesn't exist.
 */
async function loadToolManifest(rootDir) {
  try {
    return await loadManifestFile(path.join(rootDir, MANIFEST_FILE_NAME));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      throw new MissingManifestError(rootDir);
    }

    throw error;
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
 * Finds the tracked entry `--name` selects, among entries of the adapter's
 * kind. Uses the adapter's `findEntriesByName` when it has one, and
 * otherwise matches the file name, with or without its extension.
 *
 * @param {AdapterDefinition} adapter
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
 * Runs the selected action and returns its results.
 *
 * @param {CliOptions} options
 * @param {{ kinds: Object<string, KindDefinition>, rootDir: string,
 *   createClient: () => any,
 *   loadManifest: () => Promise<{ document: any, entries: Object[] }>,
 *   saveManifest: (document: any) => Promise<void> }} tool
 * @returns {Promise<Object[]>}
 */
async function runAction(options, tool) {
  const { action, id, name, fileName, parentName, force } = options;
  const { document, entries } = await tool.loadManifest();
  /** @type {Adapter} */
  const adapter = { ...options.adapter, rootDir: tool.rootDir };
  /** @param {string | undefined} kind */
  const findAdapter = (kind) => {
    const definition = kind ? tool.kinds[kind]?.adapter : undefined;

    return definition ? { ...definition, rootDir: tool.rootDir } : undefined;
  };
  const parentAdapter = findAdapter(adapter.parent?.kind);
  const followUpAdapter = findAdapter(adapter.followUpKind);
  let results;
  /** @param {Object[]} resultsSoFar */
  const saveManifest = async (resultsSoFar) => {
    try {
      await tool.saveManifest(document);
    } catch (error) {
      throw new ManifestSaveError(error, resultsSoFar);
    }
  };

  if (action === "fetch") {
    results = await actions.fetchOne(
      adapter,
      tool.createClient(),
      document,
      /** @type {string} */ (id),
      { force, fileName, followUpAdapter }
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
      // Saved after each artifact, so an interrupted bulk run keeps what
      // it already synced, rather than leaving remotes ahead of the
      // manifest.
      results = await actions.runForEach(
        adapter,
        tool.createClient(),
        document,
        actionOne,
        { force, followUpAdapter },
        saveManifest
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
        { force, parentAdapter, followUpAdapter }
      );
    }
  }

  await saveManifest(results);

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
 * @param {string} tool.command How the tool is run (e.g. "tank datadog"),
 *   for the usage text, which is built from the kinds' capabilities.
 * @param {() => any} tool.createClient Creates the API client. Called only
 *   once the flags are valid, since it reads the credentials.
 * @param {string} tool.rootDir The tool's folder, holding its manifest.
 *   Manifest paths are relative to it, so it's given to every adapter.
 * @param {() => Promise<{ document: any, entries: Object[] }>}
 *   [tool.loadManifest] Defaults to loading the manifest in `rootDir`.
 * @param {(document: any) => Promise<void>} [tool.saveManifest] Defaults
 *   to saving the manifest in `rootDir`.
 * @param {string[]} [tool.argv] Defaults to the process's arguments.
 * @returns {Promise<Summary>}
 */
export async function runCli({
  kinds,
  command,
  createClient,
  rootDir,
  loadManifest = () => loadToolManifest(rootDir),
  saveManifest = (document) =>
    saveManifestFile(document, path.join(rootDir, MANIFEST_FILE_NAME)),
  argv = process.argv.slice(2),
}) {
  assertValidCapabilities(kinds);

  const usage = buildUsage({ command, kinds });

  if (isHelpRequest(argv)) {
    return reportHelp(usage);
  }

  let summary;

  try {
    const options = parseCliArguments(argv, kinds);
    const results = await runAction(options, {
      kinds,
      rootDir,
      createClient,
      loadManifest,
      saveManifest,
    });

    summary = buildSummary(results);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${usage}`);
    } else if (error instanceof MissingManifestError) {
      console.error(error.message);
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
 * Runs a registered tool's command (`tank <name>`), on its folder at the
 * project root and the manifest in it.
 * @param {import("../project/tools.js").Tool} tool
 * @param {string[]} argv The arguments after the tool's name.
 * @returns {Promise<Summary>}
 */
export function runToolCli(tool, argv) {
  return runCli({
    kinds: tool.kinds,
    command: `tank ${tool.name}`,
    createClient: tool.createClient,
    rootDir: path.join(getProjectRoot(), tool.name),
    argv,
  });
}

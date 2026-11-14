import {
  readFile,
  writeFile,
  access,
  mkdir,
  rm,
  readdir,
  rmdir,
} from "node:fs/promises";
import path from "node:path";
import {
  listManifestEntries,
  updateManifestEntry,
  removeManifestEntry,
  isPathTracked,
  findEntryById,
} from "./manifest.js";
import { hashContent } from "./hash.js";
import { parseKebabCaseName } from "./slug.js";
import { getErrorMessage, getErrorStatus } from "./error.js";

/**
 * Implements the action contract in CONVENTIONS.md once, for every
 * kind. Each kind plugs in as an adapter that only knows how to talk to its
 * remote API and how to serialize and place its files; every check, message,
 * manifest write, and result comes from here.
 *
 * @typedef {"fetch" | "pull" | "push" | "create" | "delete"} Action
 *
 * @typedef {Object} RemoteDescription
 * @property {string} title The remote title or name, stored in the entry.
 * @property {string | number} remoteVersion What the remote-change check
 *   compares (see CONVENTIONS.md "Manifest entries").
 * @property {string} content The exact local file text for this remote.
 *
 * @typedef {Object} PushCheck
 * @property {boolean} forceable Whether --force skips this check.
 * @property {(context: { entry: Object, content: string, liveRemote: any }) =>
 *   string | null | Promise<string | null>} check Returns the failure
 *   message, or null when the check passes.
 *
 * @typedef {Object} ParentRelation
 * @property {string} flag The --create flag naming the parent, without the
 *   leading dashes (e.g. "suite"). Matched like the parent kind's --name.
 * @property {string} kind The parent's kind.
 * @property {(client: any, parentId: string, liveParent: any,
 *   childId: string) => Promise<any>} addChild Adds the child to the parent
 *   remote and returns the full parent remote after the update.
 * @property {(client: any, parentId: string, liveParent: any,
 *   childId: string) => Promise<any>} removeChild Removes the child from the
 *   parent remote and returns the full parent remote after the update.
 * @property {(client: any, childId: string) => Promise<string[]>}
 *   listParentIds Lists the IDs of the remote parents the child belongs to.
 *
 * @typedef {Object} Adapter
 * @property {string} kind The manifest `kind` (e.g. "dashboard").
 * @property {string} label Used in messages (e.g. "Datadog dashboard").
 * @property {string} systemName The remote system (e.g. "Datadog").
 * @property {Action[]} actions The actions this kind supports.
 * @property {string} rootDir Absolute folder the manifest paths are
 *   relative to: the tool's folder. Adapters don't declare it: runCli
 *   (shared/cli.js) adds it (see `AdapterDefinition`).
 * @property {boolean} allowsFileName Whether fetch accepts a file name
 *   instead of deriving it from the title.
 * @property {string} [fileNameSuffix] The suffix a file name may end with
 *   (e.g. ".json"), required when `allowsFileName` or `assignsIdOnCreate`
 *   is true.
 * @property {(entries: Object[], name: string) => Object[]}
 *   [findEntriesByName] Returns the entries (all of this kind) that --name
 *   selects. Defaults to matching the file name, with or without its
 *   extension. Return every match: more than one fails as ambiguous.
 * @property {(client: any, id: string) => Promise<any>} getRemote Reads the
 *   raw remote object. Throws an error with status 404 when it doesn't exist.
 * @property {(remote: any) => RemoteDescription} describeRemote
 * @property {(context: { client: any, document: any, id: string, remote: any,
 *   fileName?: string }) => string | Promise<string>} buildFetchPath Returns
 *   the manifest-relative path to fetch into. `fileName` is the validated
 *   file name without its suffix, when given. A path named from the title
 *   goes through `buildTitledPath` (shared/slug.js), which adds the ID
 *   when the slug is empty or its path is taken.
 * @property {(context: { client: any, document: any, entry: Object,
 *   remote: any }) => string | Promise<string>} [buildPullPath] Returns the
 *   path the entry belongs at now. Defaults to the entry's current path.
 * @property {(client: any, entry: Object, content: string, liveRemote: any)
 *   => Promise<any>} updateRemote Writes the local content to the remote and
 *   returns the full remote after the update.
 * @property {(context: { id?: string, fileName?: string, parentEntry?:
 *   Object }) => string} [buildCreatePath] Returns the path a new artifact is
 *   created from: from `id`, or, when `assignsIdOnCreate`, from the
 *   validated `fileName` (without its suffix) and the parent's entry, if
 *   any. Required when `actions` includes "create".
 * @property {(client: any, id: string | undefined, content: string) =>
 *   Promise<any>} [createRemote] Creates the remote and returns it. `id` is
 *   undefined when `assignsIdOnCreate`. Required when `actions` includes
 *   "create".
 * @property {boolean} [assignsIdOnCreate] Whether the remote assigns the ID
 *   on create, so --create takes a file name instead of an ID. Requires
 *   `fileNameSuffix`, `findRemoteIdByContent`, and `getCreatedId`.
 * @property {(client: any, content: string) => Promise<string | null>}
 *   [findRemoteIdByContent] Returns the ID of a remote that the new local
 *   content would duplicate (e.g. one with the same title), or null.
 * @property {(remote: any) => string} [getCreatedId] Reads the ID the
 *   remote assigned from what `createRemote` returned.
 * @property {ParentRelation} [parent] The parent kind the artifact can
 *   belong to: --create can add a new artifact to one, and --delete removes
 *   it from every one first.
 * @property {(client: any, id: string) => Promise<void>} [deleteRemote]
 *   Required when `actions` includes "delete".
 * @property {string} [usageNote] What the usage text can't derive from the
 *   other capabilities (e.g. what the ID is, or how `findEntriesByName`
 *   matches), printed under the kind flag.
 * @property {PushCheck[]} [pushChecks] Kind-specific push checks, run after
 *   the contract's own checks.
 * @property {string} [followUpKind] The kind `afterFetch` and `afterPull`
 *   fetch into. runCli passes that kind's adapter to them as
 *   `followUpAdapter`. Required when either is declared.
 * @property {(client: any, document: any, remote: any, options: {
 *   force: boolean, followUpAdapter: Adapter }) => Promise<Object[]>}
 *   [afterFetch] Fetches follow-up artifacts and returns their results.
 * @property {(client: any, document: any, remote: any, options: {
 *   force: boolean, followUpAdapter: Adapter }) => Promise<Object[]>}
 *   [afterPull] Fetches follow-up artifacts and returns their results.
 * @property {(context: { client: any, document: any, entry: Object,
 *   remote: any }) => string | undefined | Promise<string | undefined>}
 *   [deleteFollowUpMessage] A follow-up step to report after a delete.
 *   Called once every delete check has passed, but before the remote, the
 *   file, or the entry is deleted. `remote` is null when only untracking.
 *
 * @typedef {Omit<Adapter, "rootDir">} AdapterDefinition An adapter as its
 *   kind declares it, without `rootDir`, which runCli adds.
 */

/**
 * Builds an action result with the fields from CONVENTIONS.md "Results", in
 * that order, leaving out any that are undefined.
 *
 * @param {{ kind: string, id?: any, path?: string, action: string,
 *   status: "success" | "skipped" | "failed", remoteVersion?: any,
 *   message?: string, movedFrom?: string }} fields
 */
export function buildResult({
  kind,
  id,
  path: artifactPath,
  action,
  status,
  remoteVersion,
  message,
  movedFrom,
}) {
  const fields = {
    kind,
    id,
    path: artifactPath,
    action,
    status,
    remoteVersion,
    message,
    movedFrom,
  };

  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  );
}

function resolveFilePath(adapter, artifactPath) {
  return path.join(adapter.rootDir, artifactPath);
}

async function readLocalFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeLocalFile(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function removeFolderIfEmpty(folderPath) {
  const remainingFiles = await readdir(folderPath).catch(() => null);

  if (remainingFiles !== null && remainingFiles.length === 0) {
    await rmdir(folderPath);
  }
}

/** Reads the remote, or returns null if it doesn't exist (a 404). */
async function getRemoteOrNull(adapter, client, id) {
  try {
    return await adapter.getRemote(client, id);
  } catch (error) {
    if (getErrorStatus(error) === 404) {
      return null;
    }

    throw error;
  }
}

function isLocalContentChanged(localContent, entry) {
  return (
    localContent !== null && hashContent(localContent) !== entry.contentHash
  );
}

function buildEntryFields(adapter, id, description, content) {
  return {
    kind: adapter.kind,
    title: description.title,
    id,
    lastSyncedAt: new Date().toISOString(),
    remoteVersion: description.remoteVersion,
    contentHash: hashContent(content),
  };
}

function buildRemoteMissingMessage(adapter, id, action) {
  const missing = `${adapter.label} ${id} no longer exists in ${adapter.systemName}.`;

  if (action === "delete") {
    return `${missing} Use --force to stop tracking it.`;
  }

  if (adapter.actions.includes("delete")) {
    return `${missing} Use --delete --force to stop tracking it.`;
  }

  return `${missing} Remove its entry from sync-manifest.yaml to stop tracking it.`;
}

function buildUnsyncedLocalChangesMessage(action) {
  const consequence = action === "delete" ? "delete it anyway" : "discard it";

  return `Local file has unsynced changes (contentHash mismatch). Push it first, or use --force to ${consequence}.`;
}

function describeRemoteChange(entry, liveRemoteVersion) {
  return (
    `has changed since the last sync (remoteVersion is now ${liveRemoteVersion}, ` +
    `last synced remoteVersion was ${entry.remoteVersion})`
  );
}

function buildRemoteChangedMessage(adapter, entry, liveRemoteVersion, action) {
  const consequence = action === "delete" ? "delete it anyway" : "overwrite it";

  return `${adapter.label} ${describeRemoteChange(entry, liveRemoteVersion)}. Pull it first, or use --force to ${consequence}.`;
}

function buildInvalidFileNameMessage(fileName, fileNameSuffix) {
  return `"${fileName}" isn't a valid file name: it must be kebab-case (lowercase letters, digits, and single hyphens), with or without a trailing "${fileNameSuffix}".`;
}

function buildFailedResults(adapter, action, id, artifactPath, message) {
  return [
    buildResult({
      kind: adapter.kind,
      id,
      path: artifactPath,
      action,
      status: "failed",
      message,
    }),
  ];
}

function buildTrackedByAnotherEntryMessage(document, artifactPath) {
  const otherId = document.getIn([artifactPath, "id"]);

  return `${artifactPath} is already tracked by another entry (id ${otherId}).`;
}

function buildUnsupportedResult(adapter, id, artifactPath, action) {
  return buildResult({
    kind: adapter.kind,
    id,
    path: artifactPath,
    action,
    status: "failed",
    message: `--${action} isn't supported for ${adapter.kind}.`,
  });
}

/**
 * --fetch: starts tracking an existing remote artifact. `fileName` names
 * the new file, for adapters that allow it.
 *
 * @param {Adapter} adapter
 * @param {any} client
 * @param {any} document
 * @param {string} id
 * @param {{ force?: boolean, fileName?: string,
 *   followUpAdapter?: Adapter }} [options] `followUpAdapter` is the adapter
 *   of `adapter.followUpKind`, passed on to `afterFetch`.
 * @returns {Promise<Object[]>} The fetch result, followed by any follow-up
 *   results.
 */
export async function fetchOne(
  adapter,
  client,
  document,
  id,
  { force = false, fileName, followUpAdapter } = {}
) {
  const action = "fetch";
  const fail = (message, artifactPath) =>
    buildFailedResults(adapter, action, id, artifactPath, message);

  if (!adapter.actions.includes(action)) {
    return [buildUnsupportedResult(adapter, id, undefined, action)];
  }

  let parsedFileName;

  if (fileName !== undefined) {
    if (!adapter.allowsFileName) {
      return fail(`A file name isn't supported for ${adapter.kind}.`);
    }

    parsedFileName = parseKebabCaseName(fileName, adapter.fileNameSuffix);

    if (parsedFileName === null) {
      return fail(
        buildInvalidFileNameMessage(fileName, adapter.fileNameSuffix)
      );
    }
  }

  let artifactPath;

  try {
    const existingEntry = findEntryById(
      listManifestEntries(document),
      adapter.kind,
      id
    );

    if (existingEntry) {
      return fail(
        `${adapter.label} ${id} is already tracked at ${existingEntry.path}. Use --pull to refresh it instead.`,
        existingEntry.path
      );
    }

    const remote = await getRemoteOrNull(adapter, client, id);

    if (remote === null) {
      return fail(
        `${adapter.label} ${id} doesn't exist in ${adapter.systemName}.`
      );
    }

    artifactPath = await adapter.buildFetchPath({
      client,
      document,
      id,
      remote,
      fileName: parsedFileName,
    });
    const filePath = resolveFilePath(adapter, artifactPath);

    if (isPathTracked(document, artifactPath)) {
      return fail(
        buildTrackedByAnotherEntryMessage(document, artifactPath),
        artifactPath
      );
    }

    if (!force && (await fileExists(filePath))) {
      return fail(
        `${artifactPath} already exists and isn't tracked in the manifest. Remove or rename it, or use --force to overwrite it.`,
        artifactPath
      );
    }

    const description = adapter.describeRemote(remote);

    await writeLocalFile(filePath, description.content);
    updateManifestEntry(
      document,
      artifactPath,
      buildEntryFields(adapter, id, description, description.content)
    );

    const followUpResults = adapter.afterFetch
      ? await adapter.afterFetch(client, document, remote, {
          force: false,
          followUpAdapter: /** @type {Adapter} */ (followUpAdapter),
        })
      : [];

    return [
      buildResult({
        kind: adapter.kind,
        id,
        path: artifactPath,
        action,
        status: "success",
        remoteVersion: description.remoteVersion,
      }),
      ...followUpResults,
    ];
  } catch (error) {
    return fail(getErrorMessage(error), artifactPath);
  }
}

/**
 * --pull: remote to local.
 *
 * @param {Adapter} adapter
 * @param {any} client
 * @param {any} document
 * @param {any} entry
 * @param {{ force?: boolean, followUpAdapter?: Adapter }} [options]
 *   `followUpAdapter` is the adapter of `adapter.followUpKind`, passed on
 *   to `afterPull`.
 * @returns {Promise<Object[]>} The pull result, followed by any follow-up
 *   results.
 */
export async function pullOne(
  adapter,
  client,
  document,
  entry,
  { force = false, followUpAdapter } = {}
) {
  const action = "pull";
  const fail = (message) =>
    buildFailedResults(adapter, action, entry.id, entry.path, message);

  if (!adapter.actions.includes(action)) {
    return [buildUnsupportedResult(adapter, entry.id, entry.path, action)];
  }

  try {
    const remote = await getRemoteOrNull(adapter, client, entry.id);

    if (remote === null) {
      return fail(buildRemoteMissingMessage(adapter, entry.id, action));
    }

    const filePath = resolveFilePath(adapter, entry.path);
    const localContent = await readLocalFile(filePath);

    if (!force && isLocalContentChanged(localContent, entry)) {
      return fail(buildUnsyncedLocalChangesMessage(action));
    }

    const targetPath = adapter.buildPullPath
      ? await adapter.buildPullPath({ client, document, entry, remote })
      : entry.path;
    const targetFilePath = resolveFilePath(adapter, targetPath);
    const isMoving = targetPath !== entry.path;

    if (isMoving && isPathTracked(document, targetPath)) {
      return fail(
        `${adapter.label} should move to ${targetPath}, but ${buildTrackedByAnotherEntryMessage(document, targetPath)} Untrack the other entry first.`
      );
    }

    if (isMoving && !force && (await fileExists(targetFilePath))) {
      return fail(
        `${adapter.label} should move to ${targetPath}, but that file already exists and isn't tracked in the manifest. Remove or rename it, or use --force to overwrite it.`
      );
    }

    const description = adapter.describeRemote(remote);
    const followUpResults = async () =>
      adapter.afterPull
        ? await adapter.afterPull(client, document, remote, {
            force: false,
            followUpAdapter: /** @type {Adapter} */ (followUpAdapter),
          })
        : [];

    const isLocalFileIntact =
      localContent !== null && hashContent(localContent) === entry.contentHash;
    const isRemoteContentUnchanged =
      hashContent(description.content) === entry.contentHash;

    if (!isMoving && isLocalFileIntact && isRemoteContentUnchanged) {
      if (description.remoteVersion === entry.remoteVersion) {
        return [
          buildResult({
            kind: adapter.kind,
            id: entry.id,
            path: entry.path,
            action,
            status: "skipped",
            remoteVersion: entry.remoteVersion,
          }),
          ...(await followUpResults()),
        ];
      }

      // Only the remote's version moved on: the file is already right, so
      // track the new version without rewriting the file.
      updateManifestEntry(document, entry.path, {
        title: description.title,
        remoteVersion: description.remoteVersion,
      });

      return [
        buildResult({
          kind: adapter.kind,
          id: entry.id,
          path: entry.path,
          action,
          status: "success",
          remoteVersion: description.remoteVersion,
        }),
        ...(await followUpResults()),
      ];
    }

    await writeLocalFile(targetFilePath, description.content);

    if (isMoving) {
      await rm(filePath, { force: true });
      await removeFolderIfEmpty(path.dirname(filePath));
      removeManifestEntry(document, entry.path);
    }

    updateManifestEntry(
      document,
      targetPath,
      buildEntryFields(adapter, entry.id, description, description.content)
    );

    return [
      buildResult({
        kind: adapter.kind,
        id: entry.id,
        path: targetPath,
        action,
        status: "success",
        remoteVersion: description.remoteVersion,
        movedFrom: isMoving ? entry.path : undefined,
      }),
      ...(await followUpResults()),
    ];
  } catch (error) {
    return fail(getErrorMessage(error));
  }
}

/**
 * --push: local to remote.
 *
 * @returns {Promise<Object[]>} The push result.
 */
export async function pushOne(
  adapter,
  client,
  document,
  entry,
  { force = false } = {}
) {
  const action = "push";
  const fail = (message) =>
    buildFailedResults(adapter, action, entry.id, entry.path, message);

  if (!adapter.actions.includes(action)) {
    return [buildUnsupportedResult(adapter, entry.id, entry.path, action)];
  }

  try {
    const content = await readLocalFile(resolveFilePath(adapter, entry.path));

    if (content === null) {
      return fail(
        `Local file ${entry.path} is missing. Use --pull to restore it.`
      );
    }

    const liveRemote = await getRemoteOrNull(adapter, client, entry.id);

    if (liveRemote === null) {
      return fail(buildRemoteMissingMessage(adapter, entry.id, action));
    }

    const liveRemoteVersion = adapter.describeRemote(liveRemote).remoteVersion;

    if (!force && liveRemoteVersion !== entry.remoteVersion) {
      return fail(
        buildRemoteChangedMessage(adapter, entry, liveRemoteVersion, action)
      );
    }

    if (!force && hashContent(content) === entry.contentHash) {
      return [
        buildResult({
          kind: adapter.kind,
          id: entry.id,
          path: entry.path,
          action,
          status: "skipped",
          remoteVersion: entry.remoteVersion,
        }),
      ];
    }

    for (const pushCheck of adapter.pushChecks ?? []) {
      if (force && pushCheck.forceable) {
        continue;
      }

      const message = await pushCheck.check({ entry, content, liveRemote });

      if (message) {
        return fail(message);
      }
    }

    const updatedRemote = await adapter.updateRemote(
      client,
      entry,
      content,
      liveRemote
    );
    const description = adapter.describeRemote(updatedRemote);

    updateManifestEntry(
      document,
      entry.path,
      buildEntryFields(adapter, entry.id, description, content)
    );

    return [
      buildResult({
        kind: adapter.kind,
        id: entry.id,
        path: entry.path,
        action,
        status: "success",
        remoteVersion: description.remoteVersion,
      }),
    ];
  } catch (error) {
    return fail(getErrorMessage(error));
  }
}

/**
 * Checks that a tracked parent matches its remote before --create adds a
 * child to it, or --delete removes one, so changing the parent never
 * overwrites unsynced parent edits.
 * A missing parent file is fine: adding the child rewrites it.
 *
 * @returns {Promise<string | null>} The failure message, or null.
 */
async function checkParentIsSynced(client, { adapter, entry }) {
  const localContent = await readLocalFile(
    resolveFilePath(adapter, entry.path)
  );

  if (isLocalContentChanged(localContent, entry)) {
    return `${adapter.label} ${entry.path} has unpushed changes. Push it first.`;
  }

  const liveRemote = await getRemoteOrNull(adapter, client, entry.id);

  if (liveRemote === null) {
    return `${adapter.label} ${entry.id} no longer exists in ${adapter.systemName}.`;
  }

  const liveRemoteVersion = adapter.describeRemote(liveRemote).remoteVersion;

  if (liveRemoteVersion !== entry.remoteVersion) {
    return `${adapter.label} ${entry.path} ${describeRemoteChange(entry, liveRemoteVersion)}. Pull it first.`;
  }

  return null;
}

/**
 * Adds a child to its parent remote, or removes it, then rewrites the
 * parent's file and entry from what the remote returned, as a pull would.
 *
 * @param {Adapter} adapter The child's adapter.
 * @param {any} client
 * @param {any} document
 * @param {{ adapter: Adapter, entry: any }} parent
 * @param {string} childId
 * @param {"create" | "delete"} action Adds the child on create, removes it
 *   on delete.
 * @returns {Promise<Object>} The parent's result. Throws when the parent
 *   remote update fails.
 */
async function updateParentChildren(
  adapter,
  client,
  document,
  parent,
  childId,
  action
) {
  const { adapter: parentAdapter, entry: parentEntry } = parent;
  const relation = /** @type {ParentRelation} */ (adapter.parent);
  const liveParent = await parentAdapter.getRemote(client, parentEntry.id);
  const updatedParent = await (
    action === "create" ? relation.addChild : relation.removeChild
  )(client, parentEntry.id, liveParent, childId);
  const description = parentAdapter.describeRemote(updatedParent);

  await writeLocalFile(
    resolveFilePath(parentAdapter, parentEntry.path),
    description.content
  );
  updateManifestEntry(
    document,
    parentEntry.path,
    buildEntryFields(
      parentAdapter,
      parentEntry.id,
      description,
      description.content
    )
  );

  return buildResult({
    kind: parentAdapter.kind,
    id: parentEntry.id,
    path: parentEntry.path,
    action,
    status: "success",
    remoteVersion: description.remoteVersion,
    message: `${action === "create" ? "Added" : "Removed"} ${adapter.kind} ${childId}.`,
  });
}

/**
 * Adds a just-created child to its parent. A failure leaves the child
 * created and tracked, and fails only the parent's result.
 *
 * @returns {Promise<Object>} The parent's result.
 */
async function addChildToParent(adapter, client, document, parent, childId) {
  try {
    return await updateParentChildren(
      adapter,
      client,
      document,
      parent,
      childId,
      "create"
    );
  } catch (error) {
    return buildResult({
      kind: parent.adapter.kind,
      id: parent.entry.id,
      path: parent.entry.path,
      action: "create",
      status: "failed",
      message: `${adapter.label} ${childId} was created and tracked, but adding it to the ${parent.adapter.kind} failed: ${getErrorMessage(error)} Add it to ${parent.entry.path} and push it.`,
    });
  }
}

/**
 * --create: starts tracking a new artifact written locally. Never takes
 * --force. Kinds whose ID you choose take `id`; kinds whose ID the remote
 * assigns (`assignsIdOnCreate`) take `fileName` instead. `parent` adds the
 * new artifact to a tracked parent artifact, for kinds with `parent`.
 *
 * @param {Adapter} adapter
 * @param {any} client
 * @param {any} document
 * @param {{ id?: string, fileName?: string, parent?: { adapter: Adapter,
 *   entry: Object } }} target
 * @returns {Promise<Object[]>} The create result, followed by the parent's
 *   result when there's a parent.
 */
export async function createOne(
  adapter,
  client,
  document,
  { id, fileName, parent }
) {
  const action = "create";
  let createdId = id;
  let artifactPath;
  const fail = (message) =>
    buildFailedResults(adapter, action, createdId, artifactPath, message);

  if (
    !adapter.actions.includes(action) ||
    !adapter.buildCreatePath ||
    !adapter.createRemote ||
    (adapter.assignsIdOnCreate &&
      (!adapter.findRemoteIdByContent || !adapter.getCreatedId))
  ) {
    return [buildUnsupportedResult(adapter, id, undefined, action)];
  }

  if (adapter.assignsIdOnCreate) {
    if (id !== undefined || fileName === undefined) {
      return fail(
        `${adapter.label} IDs are assigned by ${adapter.systemName}: pass a file name, not an ID.`
      );
    }
  } else if (id === undefined || fileName !== undefined) {
    return fail(`Pass the ${adapter.label} ID, not a file name.`);
  }

  if (parent && adapter.parent?.kind !== parent.adapter.kind) {
    return fail(
      `A ${adapter.kind} can't be created inside a ${parent.adapter.kind}.`
    );
  }

  let parsedFileName;

  if (fileName !== undefined) {
    parsedFileName = parseKebabCaseName(fileName, adapter.fileNameSuffix);

    if (parsedFileName === null) {
      return fail(
        buildInvalidFileNameMessage(fileName, adapter.fileNameSuffix)
      );
    }
  }

  try {
    if (id !== undefined) {
      const existingEntry = findEntryById(
        listManifestEntries(document),
        adapter.kind,
        id
      );

      if (existingEntry) {
        artifactPath = existingEntry.path;

        return fail(
          `${adapter.label} ${id} is already tracked. Use --push to update it instead.`
        );
      }
    }

    artifactPath = adapter.buildCreatePath({
      id,
      fileName: parsedFileName,
      parentEntry: parent?.entry,
    });

    if (isPathTracked(document, artifactPath)) {
      return fail(
        `${buildTrackedByAnotherEntryMessage(document, artifactPath)} Use --push to update it instead.`
      );
    }

    const filePath = resolveFilePath(adapter, artifactPath);
    const localContent = await readLocalFile(filePath);

    if (localContent === null) {
      return fail(
        `${artifactPath} doesn't exist. Write the new ${adapter.kind} to it first.`
      );
    }

    if (parent) {
      const parentMessage = await checkParentIsSynced(client, parent);

      if (parentMessage !== null) {
        return fail(parentMessage);
      }
    }

    let existingRemoteId;

    if (adapter.assignsIdOnCreate) {
      existingRemoteId =
        await /** @type {NonNullable<Adapter["findRemoteIdByContent"]>} */ (
          adapter.findRemoteIdByContent
        )(client, localContent);
    } else {
      const remote = await getRemoteOrNull(adapter, client, id);
      existingRemoteId = remote === null ? null : id;
    }

    if (existingRemoteId !== null) {
      const sameTitle = adapter.assignsIdOnCreate ? " with the same title" : "";

      return fail(
        `${adapter.label} ${existingRemoteId} already exists in ${adapter.systemName}${sameTitle}. Use --fetch to track it instead.`
      );
    }

    let createdRemote;

    try {
      createdRemote = await adapter.createRemote(client, id, localContent);
    } catch (error) {
      // The remote can appear between the check above and the create.
      if (getErrorStatus(error) === 409) {
        // Kinds that get their ID from the remote don't know it yet.
        const subject = adapter.assignsIdOnCreate
          ? `${adapter.label} with the same title`
          : `${adapter.label} ${id}`;

        return fail(
          `${subject} already exists in ${adapter.systemName}. Use --fetch to track it instead.`
        );
      }

      throw error;
    }

    if (adapter.assignsIdOnCreate) {
      createdId = /** @type {NonNullable<Adapter["getCreatedId"]>} */ (
        adapter.getCreatedId
      )(createdRemote);
    }

    const description = adapter.describeRemote(createdRemote);

    await writeLocalFile(filePath, description.content);
    updateManifestEntry(
      document,
      artifactPath,
      buildEntryFields(adapter, createdId, description, description.content)
    );

    const results = [
      buildResult({
        kind: adapter.kind,
        id: createdId,
        path: artifactPath,
        action,
        status: "success",
        remoteVersion: description.remoteVersion,
      }),
    ];

    if (parent) {
      results.push(
        await addChildToParent(adapter, client, document, parent, createdId)
      );
    }

    return results;
  } catch (error) {
    return fail(getErrorMessage(error));
  }
}

/**
 * Lists the tracked parents the remote child belongs to, for kinds with a
 * `parent`, and checks each one can be changed. Never fetches a parent.
 *
 * @returns {Promise<{ parents: { adapter: Adapter, entry: any }[],
 *   failure: string | null }>}
 */
async function findParentsToRemoveFrom(
  adapter,
  client,
  document,
  parentAdapter,
  childId
) {
  if (!adapter.parent || !parentAdapter) {
    return { parents: [], failure: null };
  }

  const entries = listManifestEntries(document);
  const parentIds = await adapter.parent.listParentIds(client, childId);
  const untrackedIds = parentIds.filter(
    (parentId) => !findEntryById(entries, parentAdapter.kind, parentId)
  );

  if (untrackedIds.length > 0) {
    return {
      parents: [],
      failure: `${adapter.label} ${childId} also belongs to untracked ${parentAdapter.kind} ${untrackedIds.join(", ")}. Fetch it with --fetch first.`,
    };
  }

  const parents = parentIds.map((parentId) => ({
    adapter: parentAdapter,
    entry: findEntryById(entries, parentAdapter.kind, parentId),
  }));

  for (const parent of parents) {
    const failure = await checkParentIsSynced(client, parent);

    if (failure) {
      return { parents: [], failure };
    }
  }

  return { parents, failure: null };
}

/**
 * --delete: deletes the remote artifact and stops tracking it. For kinds
 * with a `parent`, first removes it from the parents it belongs to, which
 * must all be tracked and synced.
 *
 * @param {Adapter} adapter
 * @param {any} client
 * @param {any} document
 * @param {any} entry
 * @param {{ force?: boolean, parentAdapter?: Adapter }} [options]
 *   `parentAdapter` is the adapter of `adapter.parent`'s kind. Without it,
 *   no parent is changed.
 * @returns {Promise<Object[]>} The delete result, followed by one result
 *   per parent it was removed from.
 */
export async function deleteOne(
  adapter,
  client,
  document,
  entry,
  { force = false, parentAdapter } = {}
) {
  const action = "delete";
  const fail = (message) =>
    buildFailedResults(adapter, action, entry.id, entry.path, message);

  if (!adapter.actions.includes(action) || !adapter.deleteRemote) {
    return [buildUnsupportedResult(adapter, entry.id, entry.path, action)];
  }

  try {
    const filePath = resolveFilePath(adapter, entry.path);
    const localContent = await readLocalFile(filePath);

    if (!force && isLocalContentChanged(localContent, entry)) {
      return fail(buildUnsyncedLocalChangesMessage(action));
    }

    const liveRemote = await getRemoteOrNull(adapter, client, entry.id);

    if (!force && liveRemote === null) {
      return fail(buildRemoteMissingMessage(adapter, entry.id, action));
    }

    if (liveRemote !== null) {
      const liveRemoteVersion =
        adapter.describeRemote(liveRemote).remoteVersion;

      if (!force && liveRemoteVersion !== entry.remoteVersion) {
        return fail(
          buildRemoteChangedMessage(adapter, entry, liveRemoteVersion, action)
        );
      }
    }

    // Built before anything is deleted, so it can still read what the
    // delete removes (e.g. the suites a synthetic test belongs to).
    const followUpMessage = adapter.deleteFollowUpMessage
      ? await adapter.deleteFollowUpMessage({
          client,
          document,
          entry,
          remote: liveRemote,
        })
      : undefined;

    const { parents, failure } =
      liveRemote === null
        ? { parents: [], failure: null }
        : await findParentsToRemoveFrom(
            adapter,
            client,
            document,
            parentAdapter,
            entry.id
          );

    if (failure) {
      return fail(failure);
    }

    const parentResults = [];

    for (const parent of parents) {
      try {
        parentResults.push(
          await updateParentChildren(
            adapter,
            client,
            document,
            parent,
            entry.id,
            action
          )
        );
      } catch (error) {
        return [
          ...fail(
            `Removing it from ${parent.adapter.kind} ${parent.entry.id} failed: ${getErrorMessage(error)} Nothing was deleted. Run --delete again.`
          ),
          ...parentResults,
        ];
      }
    }

    if (liveRemote !== null) {
      try {
        await adapter.deleteRemote(client, entry.id);
      } catch (error) {
        const removedNote =
          parentResults.length > 0
            ? ` It was already removed from its ${parentAdapter?.kind} (see below). Run --delete again.`
            : "";

        return [
          ...fail(`${getErrorMessage(error)}${removedNote}`),
          ...parentResults,
        ];
      }
    }

    await rm(filePath, { force: true });
    await removeFolderIfEmpty(path.dirname(filePath));
    removeManifestEntry(document, entry.path);

    const results = [
      buildResult({
        kind: adapter.kind,
        id: entry.id,
        path: entry.path,
        action,
        status: "success",
        message: followUpMessage,
      }),
      ...parentResults,
    ];

    return results;
  } catch (error) {
    return fail(getErrorMessage(error));
  }
}

/**
 * Runs a per-entry action (pullOne or pushOne) on every entry of the
 * adapter's kind, one at a time, so each succeeds or fails independently.
 *
 * @param {Adapter} adapter
 * @param {any} client
 * @param {any} document
 * @param {Function} actionOne
 * @param {Object} [options] Passed to `actionOne`.
 * @param {(results: Object[]) => Promise<void>} [afterEach] Called after
 *   each entry with every result so far, e.g. to save the manifest, so an
 *   interrupted run keeps what it already synced.
 * @returns {Promise<Object[]>} Every action's results, in order.
 */
export async function runForEach(
  adapter,
  client,
  document,
  actionOne,
  options = {},
  afterEach = async () => {}
) {
  const entries = listManifestEntries(document).filter(
    (entry) => entry.kind === adapter.kind
  );
  const results = [];

  for (const entry of entries) {
    results.push(
      ...(await actionOne(adapter, client, document, entry, options))
    );
    await afterEach(results);
  }

  return results;
}

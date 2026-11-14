import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { hashContent } from "../shared/hash.js";
import { MANIFEST_FILE_NAME } from "../shared/manifest.js";
import { loadToolManifest, MissingManifestError } from "../shared/cli.js";
import { runProjectCommand } from "./project-command.js";
import { TOOLS } from "./tools.js";

const USAGE = `Usage: tank status

Lists the files in the current project that differ from what each tool's
manifest tracks: tracked files changed or deleted locally, and files no
manifest tracks. Works offline: it never reads credentials or calls a
remote, so it can't tell whether a remote changed. Takes no arguments.`;

const ACTION = "status";

const TRACKED_FILE_MESSAGES = {
  missing: "Tracked, but the file is missing. Pull it to restore it.",
  modified:
    "Changed locally since the last sync. Push it, or pull it to discard the change.",
};

/**
 * Runs "tank status" on the project root.
 * @param {string[]} argv The arguments after "status".
 */
export async function runStatus(argv) {
  return runProjectCommand({
    argv,
    usage: USAGE,
    run: (rootDir, results) => collectStatus(rootDir, { results }),
  });
}

/**
 * Compares every tool's folder with its manifest, without touching a
 * remote. Reports only what needs attention, one result per file, with its
 * `state`:
 * - "modified": tracked, and its content no longer matches `contentHash`;
 * - "missing": tracked, but the file doesn't exist;
 * - "untracked": in the tool's folder, but not in its manifest.
 * A tool whose manifest is missing gets one failed result instead.
 *
 * @param {string} rootDir The project root.
 * @param {Object} [options]
 * @param {Object[]} [options.results] Where each result is pushed as it
 *   goes, so the caller still has them when a step throws.
 * @param {import("./tools.js").Tool[]} [options.tools]
 * @returns {Promise<Object[]>}
 */
export async function collectStatus(
  rootDir,
  { results = [], tools = TOOLS } = {}
) {
  for (const tool of tools) {
    const toolDir = path.join(rootDir, tool.name);
    let entries;

    try {
      ({ entries } = await loadToolManifest(toolDir));
    } catch (error) {
      if (!(error instanceof MissingManifestError)) {
        throw error;
      }

      results.push({
        path: `${tool.name}/${MANIFEST_FILE_NAME}`,
        action: ACTION,
        status: "failed",
        message: error.message,
      });
      continue;
    }

    const trackedPaths = new Set();

    for (const entry of entries) {
      trackedPaths.add(entry.path);
      const content = await readFileOrNull(path.join(toolDir, entry.path));
      const state = findTrackedFileState(content, entry);

      if (state !== null) {
        results.push({
          kind: entry.kind,
          id: entry.id,
          path: `${tool.name}/${entry.path}`,
          action: ACTION,
          status: "success",
          state,
          message: TRACKED_FILE_MESSAGES[state],
        });
      }
    }

    for (const filePath of await listFiles(toolDir)) {
      if (filePath !== MANIFEST_FILE_NAME && !trackedPaths.has(filePath)) {
        results.push({
          path: `${tool.name}/${filePath}`,
          action: ACTION,
          status: "success",
          state: "untracked",
          message: `Not tracked in ${tool.name}/${MANIFEST_FILE_NAME}.`,
        });
      }
    }
  }

  return results;
}

/**
 * @param {string | null} content The tracked file's content, or null when
 *   it doesn't exist.
 * @param {{ contentHash?: string }} entry
 * @returns {"missing" | "modified" | null} Null when the file is in sync.
 */
function findTrackedFileState(content, entry) {
  if (content === null) {
    return "missing";
  }

  if (hashContent(content) !== entry.contentHash) {
    return "modified";
  }

  return null;
}

async function readFileOrNull(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Lists the files under a folder, recursively, as sorted forward-slash
 * paths relative to it. Skips hidden files and folders (e.g. .DS_Store).
 * @param {string} folder
 * @returns {Promise<string[]>}
 */
async function listFiles(folder) {
  const dirents = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });

  return dirents
    .filter((dirent) => dirent.isFile())
    .map((dirent) =>
      path.relative(folder, path.join(dirent.parentPath, dirent.name))
    )
    .filter((relativePath) =>
      relativePath.split(path.sep).every((part) => !part.startsWith("."))
    )
    .map((relativePath) => relativePath.split(path.sep).join("/"))
    .sort();
}

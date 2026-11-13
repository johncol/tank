import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getErrorMessage } from "../shared/error.js";

/**
 * Brings one project file to the content tank wants, writing it only when
 * that content differs, and returns its result: "Created." or "Updated."
 * when written, skipped when unchanged, or failed (e.g. when
 * `buildContent` throws), so one file's problem never stops the others.
 *
 * @param {Object} options
 * @param {string} options.rootDir The project root.
 * @param {string} options.relativePath The file's path from the project
 *   root, with "/" separators, as reported in the result.
 * @param {string} options.action The command's action, e.g. "upgrade".
 * @param {(currentContent: string | undefined) => string}
 *   options.buildContent Returns the file's new content from its current
 *   one (undefined when the file doesn't exist yet).
 * @returns {Promise<Object>} The file's result.
 */
export async function writeProjectFile({
  rootDir,
  relativePath,
  action,
  buildContent,
}) {
  const filePath = path.join(rootDir, ...relativePath.split("/"));

  try {
    const currentContent = await readFileIfExists(filePath);
    const newContent = buildContent(currentContent);

    if (newContent === currentContent) {
      return { path: relativePath, action, status: "skipped" };
    }

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, newContent, "utf8");

    return {
      path: relativePath,
      action,
      status: "success",
      message: currentContent === undefined ? "Created." : "Updated.",
    };
  } catch (error) {
    return {
      path: relativePath,
      action,
      status: "failed",
      message: getErrorMessage(error),
    };
  }
}

/**
 * Reads a text file, or returns undefined when it doesn't exist.
 * @param {string} filePath
 * @returns {Promise<string | undefined>}
 */
export async function readFileIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

/**
 * Appends text to a file's content, starting it on its own line.
 * @param {string} content
 * @param {string} addition
 * @returns {string}
 */
export function appendOnNewLine(content, addition) {
  if (content === "" || content.endsWith("\n")) {
    return `${content}${addition}`;
  }

  return `${content}\n${addition}`;
}

/**
 * Writes a path under the user's home folder from "~", for paths shown in
 * committed files, which shouldn't hold the user's home folder.
 * @param {string} absolutePath
 * @returns {string}
 */
export function formatPathFromHome(absolutePath) {
  return path.join("~", path.relative(os.homedir(), absolutePath));
}

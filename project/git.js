import { execFileSync } from "node:child_process";
import { getErrorMessage } from "../shared/error.js";

/**
 * Runs a git command in the given folder, never through a shell.
 *
 * @param {string} rootDir
 * @param {string[]} gitArguments
 * @returns {string} Its output, trimmed.
 * @throws {Error} When git fails, with its error output.
 */
export function runGit(rootDir, gitArguments) {
  try {
    return execFileSync("git", gitArguments, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch (error) {
    const errorOutput = String(
      /** @type {{ stderr?: unknown }} */ (error).stderr ?? ""
    ).trim();

    throw new Error(
      `"git ${gitArguments.join(" ")}" failed: ${errorOutput || getErrorMessage(error)}`,
      { cause: error }
    );
  }
}

/**
 * @param {string} rootDir
 * @returns {boolean} Whether the folder is inside a git work tree.
 */
export function isInsideGitWorkTree(rootDir) {
  try {
    return runGit(rootDir, ["rev-parse", "--is-inside-work-tree"]) === "true";
  } catch {
    return false;
  }
}

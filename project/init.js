import { existsSync } from "node:fs";
import path from "node:path";
import { PROJECT_ENV_FILE_NAME } from "../shared/config.js";
import { getErrorMessage } from "../shared/error.js";
import { MANIFEST_FILE_NAME } from "../shared/manifest.js";
import { isInsideGitWorkTree, runGit } from "./git.js";
import { runProjectCommand } from "./project-command.js";
import {
  PROJECT_ENV_HEADER,
  appendMissingDomainVariables,
} from "./project-env.js";
import { appendOnNewLine, writeProjectFile } from "./project-file.js";
import { TOOLS } from "./tools.js";
import { upgradeProject } from "./upgrade.js";

const USAGE = `Usage: tank init

Makes the current folder a tank project: creates tank.env, .gitignore, each
tool's folder and manifest, and the tank blocks in AGENTS.md and README.md,
then commits them (running "git init" first when the folder isn't in a git
repository). Refuses a folder that's already a project: use "tank upgrade"
there. Takes no arguments.`;

const ACTION = "init";

const COMMIT_MESSAGE = "Initialize tank project";

/** Lines .gitignore must have, so local files are never committed. */
const GITIGNORE_LINES = [".env", ".DS_Store"];

/**
 * Runs "tank init" on the current folder.
 * @param {string[]} argv The arguments after "init".
 */
export async function runInit(argv) {
  return runProjectCommand({
    argv,
    usage: USAGE,
    run: (rootDir, results) => initProject(rootDir, { results }),
  });
}

/**
 * Makes a folder a tank project, and commits only the files it created or
 * changed, so anything else already staged stays staged:
 * 1. refuses a folder that's already a project, before writing anything;
 * 2. runs "git init" when the folder isn't in a git work tree;
 * 3. adds the lines .gitignore needs;
 * 4. runs the same steps as "tank upgrade" (folders, manifests, AGENTS.md
 *    and README.md);
 * 5. writes tank.env, with every tool's domain settings left empty;
 * 6. commits.
 *
 * @param {string} rootDir The folder to make a project root.
 * @param {Object} [options]
 * @param {Object[]} [options.results] Where each result is pushed as it
 *   goes, so the caller still has them when a step throws.
 * @returns {Promise<Object[]>} One result per file checked, plus one per
 *   git step.
 * @throws {Error} When the folder is already a project, or a git step
 *   fails (the files stay written).
 */
export async function initProject(rootDir, { results = [] } = {}) {
  assertNotProject(rootDir);

  if (!isInsideGitWorkTree(rootDir)) {
    runGit(rootDir, ["init"]);
    results.push({
      action: ACTION,
      status: "success",
      message: "Initialized a git repository.",
    });
  }

  results.push(
    await writeProjectFile({
      rootDir,
      relativePath: ".gitignore",
      action: ACTION,
      buildContent: (currentContent) =>
        appendMissingLines(currentContent ?? "", GITIGNORE_LINES),
    })
  );

  // Before tank.env exists, so the upgrade steps leave it to this command.
  await upgradeProject(rootDir, { action: ACTION, results });

  results.push(
    await writeProjectFile({
      rootDir,
      relativePath: PROJECT_ENV_FILE_NAME,
      action: ACTION,
      buildContent: () =>
        appendMissingDomainVariables(PROJECT_ENV_HEADER, TOOLS),
    })
  );

  const writtenPaths = results
    .filter((result) => result.status === "success" && result.path)
    .map((result) => result.path);

  results.push(commitFiles(rootDir, writtenPaths));

  return results;
}

/**
 * @param {string} rootDir
 * @throws {Error} When the folder already has tank.env or a tool's
 *   manifest.
 */
function assertNotProject(rootDir) {
  const projectPaths = [
    PROJECT_ENV_FILE_NAME,
    ...TOOLS.map((tool) => `${tool.name}/${MANIFEST_FILE_NAME}`),
  ];

  for (const projectPath of projectPaths) {
    if (existsSync(path.join(rootDir, ...projectPath.split("/")))) {
      throw new Error(
        `${projectPath} already exists, so this folder is already a tank project. ` +
          'Run "tank upgrade" instead.'
      );
    }
  }
}

/**
 * @param {string} content
 * @param {string[]} requiredLines
 * @returns {string} The content with each line it lacks appended.
 */
function appendMissingLines(content, requiredLines) {
  const existingLines = content.split("\n").map((line) => line.trim());
  let updatedContent = content;

  for (const requiredLine of requiredLines) {
    if (!existingLines.includes(requiredLine)) {
      updatedContent = appendOnNewLine(updatedContent, `${requiredLine}\n`);
    }
  }

  return updatedContent;
}

/**
 * Commits only the given files, leaving anything else staged as it is.
 *
 * @param {string} rootDir
 * @param {string[]} filePaths Paths from the project root.
 * @returns {Object} The commit's result.
 * @throws {Error} When git can't commit (e.g. no git identity is set).
 */
function commitFiles(rootDir, filePaths) {
  try {
    runGit(rootDir, ["add", "--", ...filePaths]);
    runGit(rootDir, [
      "commit",
      "--only",
      "-m",
      COMMIT_MESSAGE,
      "--",
      ...filePaths,
    ]);
  } catch (error) {
    throw new Error(
      `The project's files are written, but committing them failed. ` +
        `Fix the problem, then commit them yourself. ${getErrorMessage(error)}`,
      { cause: error }
    );
  }

  const commitId = runGit(rootDir, ["rev-parse", "--short", "HEAD"]);

  return {
    action: ACTION,
    status: "success",
    message: `Committed ${filePaths.length} files as ${commitId}.`,
  };
}

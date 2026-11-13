import { existsSync } from "node:fs";
import path from "node:path";
import { PROJECT_ENV_FILE_NAME } from "../shared/config.js";
import { MANIFEST_FILE_NAME } from "../shared/manifest.js";
import { applyManagedBlock } from "./managed-block.js";
import { MANAGED_FILES } from "./managed-files.js";
import { MIGRATIONS, runMigrations } from "./migrations.js";
import { runProjectCommand } from "./project-command.js";
import { appendMissingDomainVariables } from "./project-env.js";
import { writeProjectFile } from "./project-file.js";
import { TOOLS } from "./tools.js";

const USAGE = `Usage: tank upgrade

Brings the current project up to date with this version of tank: runs the
migrations it needs, and adds or refreshes the tools' folders and manifest
headers, the tank blocks in AGENTS.md and README.md, and the domain settings
in tank.env. Never deletes anything, and never commits. Takes no arguments.`;

/**
 * Runs "tank upgrade" on the project root.
 * @param {string[]} argv The arguments after "upgrade".
 */
export async function runUpgrade(argv) {
  return runProjectCommand({
    argv,
    usage: USAGE,
    run: (rootDir, results) => upgradeProject(rootDir, { results }),
  });
}

/**
 * Brings a project up to date with this version of tank, adding or
 * refreshing what tank owns, and never deleting anything:
 * 1. runs the migrations the project needs;
 * 2. makes sure every tool has its folder and manifest, with tank's
 *    current header (entries are never touched);
 * 3. puts tank's current block in AGENTS.md and README.md;
 * 4. adds the domain settings tank.env doesn't mention yet (it never
 *    creates tank.env: that's "tank init"'s job).
 * "tank init" runs it too, so both commands always agree.
 *
 * @param {string} rootDir The project root.
 * @param {Object} [options]
 * @param {string} [options.action] Reported in each result.
 * @param {import("./migrations.js").Migration[]} [options.migrations]
 * @param {Object[]} [options.results] Where each result is pushed as it
 *   goes, so the caller still has them when a step throws.
 * @returns {Promise<Object[]>} One result per file checked, and per
 *   migration run.
 * @throws {Error} When a migration fails.
 */
export async function upgradeProject(
  rootDir,
  { action = "upgrade", migrations = MIGRATIONS, results = [] } = {}
) {
  results.push(...(await runMigrations(rootDir, action, migrations)));

  for (const tool of TOOLS) {
    results.push(
      await writeProjectFile({
        rootDir,
        relativePath: `${tool.name}/${MANIFEST_FILE_NAME}`,
        action,
        buildContent: (currentContent) =>
          currentContent === undefined
            ? tool.manifestHeader
            : replaceManifestHeader(currentContent, tool.manifestHeader),
      })
    );
  }

  for (const managedFile of MANAGED_FILES) {
    results.push(
      await writeProjectFile({
        rootDir,
        relativePath: managedFile.path,
        action,
        buildContent: (currentContent) =>
          applyManagedBlock(
            currentContent ?? managedFile.buildHeading(rootDir),
            managedFile.blockContent
          ),
      })
    );
  }

  if (existsSync(path.join(rootDir, PROJECT_ENV_FILE_NAME))) {
    results.push(
      await writeProjectFile({
        rootDir,
        relativePath: PROJECT_ENV_FILE_NAME,
        action,
        buildContent: (currentContent) =>
          appendMissingDomainVariables(
            /** @type {string} */ (currentContent),
            TOOLS
          ),
      })
    );
  }

  return results;
}

/**
 * Replaces a manifest's header (the comment and blank lines at the top of
 * the file) and keeps its entries byte for byte, one blank line below it.
 *
 * @param {string} content The manifest's current content.
 * @param {string} header The new header, ending with a newline.
 * @returns {string}
 */
function replaceManifestHeader(content, header) {
  const lines = content.split("\n");
  const firstEntryLineIndex = lines.findIndex(
    (line) => !line.startsWith("#") && line.trim() !== ""
  );

  if (firstEntryLineIndex === -1) {
    return header;
  }

  return `${header}\n${lines.slice(firstEntryLineIndex).join("\n")}`;
}

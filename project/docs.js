import path from "node:path";
import { fileURLToPath } from "node:url";
import { runProjectCommand } from "./project-command.js";

const USAGE = `Usage: tank docs

Prints where this copy of tank's docs are: the absolute paths of its
README.md (every command and flag) and CONVENTIONS.md (the rules every
command follows). Works anywhere, even outside a project. Takes no
arguments.`;

const ACTION = "docs";

/** This copy of tank's root folder, wherever it's checked out. */
const TANK_ROOT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** The docs "tank docs" points at, from tank's root folder. */
const DOC_FILE_NAMES = ["README.md", "CONVENTIONS.md"];

/**
 * Runs "tank docs": prints each doc's absolute path to stderr, one per
 * line, and reports them as results in the JSON summary on stdout.
 * @param {string[]} argv The arguments after "docs".
 */
export async function runDocs(argv) {
  return runProjectCommand({
    argv,
    usage: USAGE,
    run: async (_rootDir, results) => {
      for (const docFileName of DOC_FILE_NAMES) {
        const docPath = path.join(TANK_ROOT_PATH, docFileName);

        console.error(docPath);
        results.push({ path: docPath, action: ACTION, status: "success" });
      }
    },
  });
}

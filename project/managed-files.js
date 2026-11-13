import path from "node:path";
import { fileURLToPath } from "node:url";
import { USER_ENV_DISPLAY_PATH } from "./project-env.js";
import { formatPathFromHome } from "./project-file.js";

/** Where this copy of tank lives, so a project's docs can point at it. */
const TANK_REPO_DISPLAY_PATH = formatPathFromHome(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
);

const AGENTS_BLOCK_CONTENT = `## tank

This folder is a tank project. The artifacts in each tool's folder
(\`confluence/\`, \`datadog/\`) are synced with Confluence and Datadog by the
\`tank\` command (on the PATH). Always run it from this folder, the project
root.

Examples:

- \`tank confluence --pull\`
- \`tank confluence --push --name=<file>.md\`
- \`tank datadog --dashboards --pull\`
- \`tank datadog --log-metrics --fetch --id=<metricId>\`

Every action and flag is documented in the tank README
(\`${TANK_REPO_DISPLAY_PATH}/README.md\`) and in
\`${TANK_REPO_DISPLAY_PATH}/CONVENTIONS.md\`.

- Never edit a \`sync-manifest.yaml\` by hand.
- tank owns the manifest headers and this block: \`tank upgrade\` rewrites
  them.
- \`tank.env\` is committed and holds only domain settings. Credentials live
  in \`${USER_ENV_DISPLAY_PATH}\`.
- Sync commands never touch git: commit artifact changes yourself.
- After tank changes, run \`tank upgrade\` and review the diff.
`;

const README_BLOCK_CONTENT = `## Synced artifacts

This repo's artifacts are synced with Confluence and Datadog using tank
(\`${TANK_REPO_DISPLAY_PATH}/README.md\`). See [AGENTS.md](AGENTS.md) for
how to run it.
`;

/**
 * A markdown file at the project root holding a block tank owns.
 * @typedef {Object} ManagedFile
 * @property {string} path The file's path from the project root.
 * @property {string} blockContent The markdown between the block's markers.
 * @property {(rootDir: string) => string} buildHeading The heading a new
 *   file starts with, before the block.
 */

/** @type {ManagedFile[]} */
export const MANAGED_FILES = [
  {
    path: "AGENTS.md",
    blockContent: AGENTS_BLOCK_CONTENT,
    buildHeading: () => "# Agent instructions\n",
  },
  {
    path: "README.md",
    blockContent: README_BLOCK_CONTENT,
    buildHeading: (rootDir) => `# ${path.basename(rootDir)}\n`,
  },
];

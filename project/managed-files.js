import path from "node:path";
import { USER_ENV_DISPLAY_PATH } from "./project-env.js";
import { TOOLS } from "./tools.js";

const TOOL_FOLDERS = TOOLS.map((tool) => `\`${tool.name}/\``).join(", ");

const SERVICE_NAMES = new Intl.ListFormat("en", {
  type: "conjunction",
}).format(TOOLS.map((tool) => tool.serviceName));

const TOOL_EXAMPLES = TOOLS.flatMap((tool) =>
  tool.examples.map((example) => `- \`tank ${tool.name} ${example}\``)
).join("\n");

const AGENTS_BLOCK_CONTENT = `## tank

This folder is a tank project. The artifacts in each tool's folder
(${TOOL_FOLDERS}) are synced with ${SERVICE_NAMES} by the
\`tank\` command (on the PATH). Always run it from this folder, the project
root.

Examples:

${TOOL_EXAMPLES}

Every action and flag is documented in tank's README.md and
CONVENTIONS.md. Run \`tank docs\` to see where they are.

- Never edit a \`sync-manifest.yaml\` by hand.
- tank owns the manifest headers and this block: \`tank upgrade\` rewrites
  them.
- \`tank.env\` is committed and holds only domain settings. Credentials live
  in \`${USER_ENV_DISPLAY_PATH}\`.
- Sync commands never touch git: commit artifact changes yourself.
- After tank changes, run \`tank upgrade\` and review the diff.
`;

const README_BLOCK_CONTENT = `## Synced artifacts

This repo's artifacts are synced with ${SERVICE_NAMES} using tank.
See [AGENTS.md](AGENTS.md) for how to run it, and run \`tank docs\` to find
tank's docs.
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

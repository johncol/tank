#!/usr/bin/env node
import { runDocs } from "../project/docs.js";
import { runInit } from "../project/init.js";
import { runStatus } from "../project/status.js";
import { runUpgrade } from "../project/upgrade.js";
import { assertProjectRoot } from "../project/project-root.js";
import { TOOLS } from "../project/tools.js";
import { runToolCli } from "../shared/cli.js";
import {
  buildSummary,
  isHelpRequest,
  reportHelp,
  reportSummary,
} from "../shared/summary.js";
import { getProjectRoot } from "../shared/config.js";
import { getErrorMessage } from "../shared/error.js";
import { wrapText } from "../shared/wrap-text.js";

const USAGE_WIDTH = 80;
const COMMAND_COLUMN_WIDTH = 14;

const COMMANDS = [
  {
    name: "init",
    description: "Makes the current folder a tank project, and commits it.",
  },
  {
    name: "upgrade",
    description:
      "Brings the current project up to date with this version of tank.",
  },
  {
    name: "status",
    description: "Lists local files that differ from the manifests, offline.",
  },
  {
    name: "docs",
    description: "Prints where tank's README.md and CONVENTIONS.md are.",
  },
  ...TOOLS,
];

const USAGE = `Usage: tank <command> [flags]

Commands:
${COMMANDS.map(formatCommandUsage).join("\n")}

Flags:
  -h, --help    Prints the usage text of tank, or of the command it follows.

Run every command but init and docs from the project root (the folder with
tank.env). Run
"tank <command> --help" to see a command's usage.`;

const [commandName, ...commandArguments] = process.argv.slice(2);
const tool = TOOLS.find((candidate) => candidate.name === commandName);

if (commandName !== undefined && isHelpRequest([commandName])) {
  reportHelp(USAGE);
} else if (commandName === "init") {
  await runInit(commandArguments);
} else if (commandName === "docs") {
  await runDocs(commandArguments);
} else if (commandName === "upgrade") {
  await runInProjectRoot(runUpgrade);
} else if (commandName === "status") {
  await runInProjectRoot(runStatus);
} else if (tool) {
  await runInProjectRoot((argv) => runToolCli(tool, argv));
} else {
  const message = commandName
    ? `Unknown command "${commandName}".`
    : "Missing command.";

  console.error(`${message}\n\n${USAGE}`);
  reportSummary(buildSummary([], message));
}

/**
 * Runs a command that needs a project root, after checking the current
 * folder is one. Skips the check for `--help`, which the command handles
 * without touching the project.
 * @param {(argv: string[]) => Promise<unknown>} runCommand
 */
async function runInProjectRoot(runCommand) {
  if (isHelpRequest(commandArguments)) {
    await runCommand(commandArguments);

    return;
  }

  try {
    assertProjectRoot(getProjectRoot());
  } catch (error) {
    const message = getErrorMessage(error);

    console.error(message);
    reportSummary(buildSummary([], message));

    return;
  }

  await runCommand(commandArguments);
}

/**
 * Formats a command's line in the usage text, wrapping its description
 * under the description column.
 * @param {{ name: string, description: string }} command
 * @returns {string}
 */
function formatCommandUsage({ name, description }) {
  return wrapText([description], {
    firstLine: `  ${name.padEnd(COMMAND_COLUMN_WIDTH)}`,
    indent: " ".repeat(2 + COMMAND_COLUMN_WIDTH),
    width: USAGE_WIDTH,
  });
}

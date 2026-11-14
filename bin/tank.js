#!/usr/bin/env node
import { runDocs } from "../project/docs.js";
import { runInit } from "../project/init.js";
import { runUpgrade } from "../project/upgrade.js";
import { assertProjectRoot } from "../project/project-root.js";
import { TOOLS } from "../project/tools.js";
import {
  buildSummary,
  isHelpRequest,
  reportHelp,
  reportSummary,
} from "../shared/cli.js";
import { getProjectRoot } from "../shared/config.js";
import { getErrorMessage } from "../shared/error.js";

const USAGE = `Usage: tank <command> [flags]

Commands:
  init          Makes the current folder a tank project, and commits it.
  upgrade       Brings the current project up to date with this version of tank.
  docs          Prints where tank's README.md and CONVENTIONS.md are.
  confluence    Syncs Confluence pages.
  datadog       Syncs Datadog dashboards, log-based metrics, and synthetic
                tests and suites.

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
} else if (tool) {
  await runInProjectRoot(tool.run);
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

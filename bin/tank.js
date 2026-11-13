#!/usr/bin/env node
import { runInit } from "../project/init.js";
import { runUpgrade } from "../project/upgrade.js";
import { assertProjectRoot } from "../project/project-root.js";
import { TOOLS } from "../project/tools.js";
import { buildSummary, reportSummary } from "../shared/cli.js";
import { getProjectRoot } from "../shared/config.js";
import { getErrorMessage } from "../shared/error.js";

const USAGE = `Usage: tank <command> [flags]

Commands:
  init          Makes the current folder a tank project, and commits it.
  upgrade       Brings the current project up to date with this version of tank.
  confluence    Syncs Confluence pages.
  datadog       Syncs Datadog dashboards, log-based metrics, and synthetic
                tests and suites.

Run every command from the project root (the folder with tank.env). Run a
tool command without flags to see its usage.`;

const [commandName, ...commandArguments] = process.argv.slice(2);
const tool = TOOLS.find((candidate) => candidate.name === commandName);

if (commandName === "init") {
  await runInit(commandArguments);
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
 * folder is one.
 * @param {(argv: string[]) => Promise<unknown>} runCommand
 */
async function runInProjectRoot(runCommand) {
  try {
    assertProjectRoot(getProjectRoot());
  } catch (error) {
    reportSummary(buildSummary([], getErrorMessage(error)));

    return;
  }

  await runCommand(commandArguments);
}

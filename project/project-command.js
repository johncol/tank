import {
  UsageError,
  buildSummary,
  isHelpRequest,
  reportHelp,
  reportSummary,
} from "../shared/cli.js";
import { getProjectRoot } from "../shared/config.js";
import { getErrorMessage } from "../shared/error.js";

/**
 * Runs "tank init", "tank upgrade", or "tank docs" from the command line:
 * they take no arguments but `--help`, and get the project root (which
 * "tank docs" ignores). Prints exactly one JSON summary
 * to stdout, with the results gathered so far when the run stops with an
 * error, and sets the exit code, the same way as the sync tools' runCli.
 *
 * @param {Object} command
 * @param {string[]} command.argv The arguments after the command's name.
 * @param {string} command.usage The usage text printed on any argument.
 * @param {(rootDir: string, results: Object[]) => Promise<unknown>}
 *   command.run Runs the command, pushing each result into `results` as it
 *   goes.
 * @returns {Promise<import("../shared/cli.js").Summary>}
 */
export async function runProjectCommand({ argv, usage, run }) {
  if (isHelpRequest(argv)) {
    return reportHelp(usage);
  }

  const results = [];
  let summary;

  try {
    if (argv.length > 0) {
      throw new UsageError(`Unexpected argument "${argv[0]}".`);
    }

    await run(getProjectRoot(), results);
    summary = buildSummary(results);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${usage}`);
    } else {
      console.error(error);
    }

    summary = buildSummary(results, getErrorMessage(error));
  }

  reportSummary(summary);

  return summary;
}

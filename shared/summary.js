/**
 * The one JSON summary every tank command prints to stdout, and the exit
 * code that comes with it.
 *
 * @typedef {Object} Summary
 * @property {boolean} ok Whether the run had no error and no failed result.
 * @property {string} [error] Why the run stopped before or while running
 *   the action (invalid flags, or an unexpected error).
 * @property {number} total
 * @property {number} succeeded
 * @property {number} skipped
 * @property {number} failed
 * @property {Object[]} results
 */

/** Flags that ask for a command's usage text instead of running it. */
const HELP_FLAGS = ["--help", "-h"];

/**
 * Builds the run's JSON summary from its results, and the error that
 * stopped it, if any.
 *
 * @param {Object[]} results
 * @param {string} [error]
 * @returns {Summary}
 */
export function buildSummary(results, error) {
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter(
    (result) => result.status === "skipped"
  ).length;

  return {
    ok: error === undefined && failed === 0,
    ...(error === undefined ? {} : { error }),
    total: results.length,
    succeeded: results.length - failed - skipped,
    skipped,
    failed,
    results,
  };
}

/**
 * Whether the command line asks for the usage text (`--help` or `-h`
 * anywhere), which every tank command handles before anything else.
 * @param {string[]} argv
 * @returns {boolean}
 */
export function isHelpRequest(argv) {
  return argv.some((argument) => HELP_FLAGS.includes(argument));
}

/**
 * Prints a command's usage text to stderr and a successful empty summary to
 * stdout, so `--help` keeps stdout to the one JSON summary.
 * @param {string} usage
 * @returns {Summary}
 */
export function reportHelp(usage) {
  const summary = buildSummary([]);

  console.error(usage);
  reportSummary(summary);

  return summary;
}

/**
 * Prints a command's one JSON summary to stdout and sets the exit code
 * from it, the same way for every tank command.
 * @param {Summary} summary
 */
export function reportSummary(summary) {
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.ok ? 0 : 1;
}

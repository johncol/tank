import { DatadogClient } from "./lib/datadog-client.js";
import { loadManifest, saveManifest } from "./lib/manifest.js";
import { KINDS } from "./lib/kinds.js";
import { runCli } from "../shared/cli.js";

const USAGE = `Usage: tank datadog <kind> <action> [--id=<id> | --name=<name>] [--file-name=<kebab-case-name>] [--suite=<suite-folder>] [--force]

Kind (exactly one):
  --dashboards          actions: --fetch, --pull, --push
  --log-metrics         actions: --fetch, --pull, --push, --create, --delete
  --synthetic-tests     actions: --fetch, --pull, --push, --create, --delete
  --synthetic-suites    actions: --fetch, --pull, --push, --delete

Action (exactly one): --fetch, --pull, --push, --create, --delete

  --id=<id>             The remote ID (dashboard ID, metric ID, or synthetic public ID).
                        Required with --fetch, and with --log-metrics --create.
  --name=<name>         Selects a tracked artifact by its file name, with or without
                        .json (a suite's folder name, with or without a trailing /).
                        Only with --pull, --push, --delete.
  --file-name=<name>    Names the new file: on --fetch, --dashboards only; on
                        --create, --synthetic-tests only (required there, since
                        Datadog assigns the ID).
  --suite=<folder>      With --synthetic-tests --create: creates the test in this
                        tracked suite's folder and adds it to the suite.
  --force               Overrides the forceable checks. Not accepted with --create.

--pull and --push without --id or --name run on every tracked artifact of the kind.
--delete always needs --id or --name.`;

/**
 * Runs "tank datadog" with the given arguments (everything after the
 * command name).
 * @param {string[]} argv
 */
export async function runDatadogCli(argv) {
  return runCli({
    kinds: KINDS,
    usage: USAGE,
    createClient: () => new DatadogClient(),
    loadManifest,
    saveManifest,
    argv,
  });
}

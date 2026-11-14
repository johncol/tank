import { DatadogClient } from "./lib/datadog-client.js";
import { loadManifest, saveManifest } from "./lib/manifest.js";
import { KINDS } from "./lib/kinds.js";
import { runCli } from "../shared/cli.js";

/**
 * Runs "tank datadog" with the given arguments (everything after the
 * command name).
 * @param {string[]} argv
 */
export async function runDatadogCli(argv) {
  return runCli({
    kinds: KINDS,
    command: "tank datadog",
    createClient: () => new DatadogClient(),
    loadManifest,
    saveManifest,
    argv,
  });
}

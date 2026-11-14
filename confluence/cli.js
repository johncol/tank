import { ConfluenceClient } from "./lib/confluence-client.js";
import { loadManifest, saveManifest } from "./lib/manifest.js";
import { KINDS } from "./lib/kinds.js";
import { runCli } from "../shared/cli.js";

/**
 * Runs "tank confluence" with the given arguments (everything after the
 * command name).
 * @param {string[]} argv
 */
export async function runConfluenceCli(argv) {
  return runCli({
    kinds: KINDS,
    command: "tank confluence",
    createClient: () => new ConfluenceClient(),
    loadManifest,
    saveManifest,
    argv,
  });
}

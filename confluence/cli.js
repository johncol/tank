import { ConfluenceClient } from "./lib/confluence-client.js";
import { loadManifest, saveManifest } from "./lib/manifest.js";
import { KINDS } from "./lib/kinds.js";
import { runCli } from "../shared/cli.js";

const USAGE = `Usage: tank confluence [--pages] <action> [--id=<pageId> | --name=<name>] [--file-name=<kebab-case-name>] [--force]

Pages are the only kind, so --pages is optional.

Action (exactly one): --fetch, --pull, --push, --create

  --id=<pageId>         The Confluence page ID. Required with --fetch.
  --name=<name>         Selects a tracked page by its file name, with or without .md.
                        Only with --pull and --push.
  --file-name=<name>    Names the new file: on --fetch, instead of the page title;
                        on --create, required, since Confluence assigns the ID.
                        A new page's file starts with its title as a "# " heading.
  --force               Overrides the forceable checks. Not accepted with --create.

--pull and --push without --id or --name run on every tracked page.`;

/**
 * Runs "tank confluence" with the given arguments (everything after the
 * command name).
 * @param {string[]} argv
 */
export async function runConfluenceCli(argv) {
  return runCli({
    kinds: KINDS,
    usage: USAGE,
    createClient: () => new ConfluenceClient(),
    loadManifest,
    saveManifest,
    argv,
  });
}

import { ConfluenceClient } from "./lib/confluence-client.js";
import { pageAdapter } from "./lib/pages/adapter.js";

/**
 * "tank confluence", registered in project/tools.js.
 * @type {import("../project/tools.js").Tool}
 */
export const confluenceTool = {
  name: "confluence",
  serviceName: "Confluence",
  description: "Syncs Confluence pages.",
  examples: ["--pull", "--push --name=<file>.md"],
  kinds: {
    page: {
      flag: "pages",
      adapter: pageAdapter,
    },
  },
  manifestHeader: `# Source of truth for which markdown docs are synced with which Confluence
# pages. Read and written by tank ("tank confluence"), which also owns this
# header: "tank upgrade" rewrites it, and never touches the entries.
#
# Each entry is keyed by the markdown file's path and holds:
#   kind: always "page".
#   title: the page title.
#   id: the Confluence page ID.
#   lastSyncedAt: when a sync last changed the file or the page.
#   remoteVersion: the page's Confluence version number at the last sync. A
#     push compares the live version against it to detect upstream edits.
#   contentHash: hash of the markdown file at the last sync.
`,
  // Only --create needs them, so ConfluenceClient checks them there.
  domainVariables: [
    {
      name: "CONFLUENCE_SPACE_ID",
      description:
        "The ID of the Confluence space new pages are created in (--create only).",
    },
    {
      name: "CONFLUENCE_PARENT_ID",
      description:
        "The ID of the page or folder new pages are created under (--create only).",
    },
  ],
  createClient: () => new ConfluenceClient(),
};

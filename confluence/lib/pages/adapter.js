import { CONFLUENCE_DIR, isPathTracked } from "../manifest.js";
import { markdownToAdf, adfToMarkdown } from "../markdown.js";
import { buildTitledPath } from "../../../shared/slug.js";

const PAGES_PATH = "synced";

const VERSION_MESSAGE = "Synced from markdown via confluence push script";

const ROUND_TRIP_PROBLEM =
  "This markdown doesn't round-trip through Confluence's format: converting it there and back " +
  "produces different text, so sending it would silently change its content on Confluence.";

const ROUND_TRIP_FAILURE_MESSAGE = `${ROUND_TRIP_PROBLEM} Fix the file so a pull wouldn't change it, or use --force to push anyway.`;

const TITLE_HEADING_PATTERN = /^# +(\S.*?)[ \t]*(?:\n+|$)/;

const MISSING_TITLE_HEADING_MESSAGE =
  'Start the file with the page title as a "# " heading: it becomes the page title, and is left out of the page body.';

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeysDeep(value[key])])
    );
  }

  return value;
}

/**
 * Normalizes `attrs='{...}'` JSON embedded in `<!-- adf:... -->` metadata
 * comments by sorting object keys, so comparing two otherwise-identical
 * markdown strings isn't tripped up by harmless key-order differences the
 * parser introduces when it rebuilds those attrs from scratch.
 */
function normalizeAdfCommentAttrs(markdown) {
  return markdown.replace(/attrs='(\{.*?\})'/g, (match, json) => {
    try {
      return `attrs='${JSON.stringify(sortKeysDeep(JSON.parse(json)))}'`;
    } catch {
      return match;
    }
  });
}

// Strict on purpose, trailing newlines included: Confluence trims them, so a
// push whose only change is an editor-added newline would have no effect on
// the page. Failing tells the user nothing would change instead of reporting
// a push that did nothing. Don't relax this to ignore trailing newlines.
function isRoundTripSafe(markdown) {
  return (
    normalizeAdfCommentAttrs(adfToMarkdown(markdownToAdf(markdown))) ===
    normalizeAdfCommentAttrs(markdown)
  );
}

/**
 * Splits a new page's markdown into its title, from the leading "# "
 * heading, and the body below it. Confluence shows the title apart from the
 * body, so the heading is left out of the body.
 *
 * @param {string} markdown
 * @returns {{ title: string, body: string }}
 */
function splitTitleHeading(markdown) {
  const match = markdown.match(TITLE_HEADING_PATTERN);

  if (match === null) {
    throw new Error(MISSING_TITLE_HEADING_MESSAGE);
  }

  // Pulled files never end in a newline, but editors often add one to a new
  // file. Dropping it loses nothing: create rewrites the file anyway.
  const body = markdown.slice(match[0].length).replace(/\n+$/, "");

  return { title: match[1], body };
}

/**
 * Plugs Confluence pages into the shared action engine (shared/actions.js).
 * Files are markdown converted from the page's ADF body (see markdown.js),
 * named from the page title unless a file name is given on fetch.
 *
 * Pushing never renames a page: it sends the live page title, since the
 * manifest title is only a record for humans. Confluence also checks the
 * version server-side: an update must carry the live version number plus
 * one.
 *
 * Confluence assigns a new page's ID, so --create takes a file name. The
 * new file's leading "# " heading becomes the page title and is left out of
 * the page body, so create rewrites the file without it. Pages are created
 * in CONFLUENCE_SPACE_ID, under CONFLUENCE_PARENT_ID.
 *
 * @type {import("../../../shared/actions.js").Adapter}
 */
export const pageAdapter = {
  kind: "page",
  label: "Confluence page",
  systemName: "Confluence",
  actions: ["fetch", "pull", "push", "create"],
  rootDir: CONFLUENCE_DIR,
  allowsFileName: true,
  fileNameSuffix: ".md",
  assignsIdOnCreate: true,

  async getRemote(client, id) {
    return client.getPage(id);
  },

  describeRemote(page) {
    return {
      title: page.title,
      remoteVersion: page.version.number,
      content: adfToMarkdown(JSON.parse(page.body.atlas_doc_format.value)),
    };
  },

  buildFetchPath({ document, id, remote, fileName }) {
    const buildPath = (name) => `${PAGES_PATH}/${name}.md`;

    if (fileName !== undefined) {
      return buildPath(fileName);
    }

    return buildTitledPath({
      title: remote.title,
      id,
      buildPath,
      isPathTaken: (artifactPath) => isPathTracked(document, artifactPath),
    });
  },

  // Some markdown (e.g. macros serialized as raw ADF JSON, or a code
  // block's "wrap" flag) has no real round-trip support in the parser:
  // pushing it would silently replace it on Confluence with something a
  // later pull can't reconstruct.
  pushChecks: [
    {
      forceable: true,
      check({ content }) {
        return isRoundTripSafe(content) ? null : ROUND_TRIP_FAILURE_MESSAGE;
      },
    },
  ],

  async updateRemote(client, entry, content, liveRemote) {
    await client.updatePage(entry.id, {
      title: liveRemote.title,
      adf: markdownToAdf(content),
      currentVersionNumber: liveRemote.version.number,
      versionMessage: VERSION_MESSAGE,
    });

    // The update response isn't guaranteed to carry the ADF body, so read
    // the page back to describe it.
    return client.getPage(entry.id);
  },

  buildCreatePath({ fileName }) {
    return `${PAGES_PATH}/${fileName}.md`;
  },

  async findRemoteIdByContent(client, content) {
    return client.findPageIdByTitle(splitTitleHeading(content).title);
  },

  async createRemote(client, id, content) {
    const { title, body } = splitTitleHeading(content);

    // Not forceable, since --create never takes --force.
    if (!isRoundTripSafe(body)) {
      throw new Error(
        `${ROUND_TRIP_PROBLEM} Fix the file so a pull wouldn't change it.`
      );
    }

    const createdPage = await client.createPage({
      title,
      adf: markdownToAdf(body),
    });

    // Read it back, as updateRemote does, for the ADF body.
    return client.getPage(createdPage.id);
  },

  getCreatedId(page) {
    return page.id;
  },
};

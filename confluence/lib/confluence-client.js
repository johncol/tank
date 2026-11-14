import { requestJson } from "../../shared/http.js";
import {
  PROJECT_ENV_FILE_NAME,
  readProjectEnvironment,
  readUserVariables,
} from "../../shared/config.js";

/**
 * Reads and validates the Confluence settings: the connection settings
 * from the environment (populated from the user's credentials file, see
 * .env.example), and `spaceId` and `parentId` from the project's tank.env.
 * Only --create needs those two, so they're checked there, not here.
 * @returns {{ baseUrl: string, email: string, apiToken: string,
 *   spaceId?: string, parentId?: string }}
 */
function readConfluenceConfig() {
  const variables = readUserVariables([
    "CONFLUENCE_BASE_URL",
    "CONFLUENCE_EMAIL",
    "CONFLUENCE_API_TOKEN",
  ]);
  const projectEnvironment = readProjectEnvironment();

  return {
    baseUrl: variables.CONFLUENCE_BASE_URL.replace(/\/+$/, ""),
    email: variables.CONFLUENCE_EMAIL,
    apiToken: variables.CONFLUENCE_API_TOKEN,
    spaceId: projectEnvironment.CONFLUENCE_SPACE_ID || undefined,
    parentId: projectEnvironment.CONFLUENCE_PARENT_ID || undefined,
  };
}

/**
 * Thin wrapper around the Confluence Cloud REST API v2 for the single page
 * operations the sync scripts need. Pages are always read/written using the
 * "atlas_doc_format" (ADF) body representation, since that is the format the
 * markdown converter in markdown.js produces and consumes.
 */
export class ConfluenceClient {
  constructor(
    config = readConfluenceConfig(),
    { rateLimitWaitMultiplier = 1 } = {}
  ) {
    this.baseUrl = config.baseUrl;
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
    this.spaceId = config.spaceId;
    this.parentId = config.parentId;
    // Lets tests skip the real rate-limit wait.
    this.rateLimitWaitMultiplier = rateLimitWaitMultiplier;
  }

  /**
   * Sends a request (see shared/http.js for rate-limit retries and errors).
   *
   * @param {string} path
   * @param {{ method?: string, body?: unknown }} [options]
   */
  async request(path, { method = "GET", body } = {}) {
    return requestJson(`${this.baseUrl}/api/v2${path}`, {
      serviceName: "Confluence",
      headers: { Authorization: this.authHeader },
      rateLimitResetHeader: "retry-after",
      method,
      body,
      rateLimitWaitMultiplier: this.rateLimitWaitMultiplier,
    });
  }

  /** The space new pages are created in, and looked up by title in. */
  requireSpaceId() {
    return requireDomainSetting("CONFLUENCE_SPACE_ID", this.spaceId);
  }

  /** The page or folder new pages are created under. */
  requireParentId() {
    return requireDomainSetting("CONFLUENCE_PARENT_ID", this.parentId);
  }

  /**
   * Finds the ID of the page with this exact title in CONFLUENCE_SPACE_ID,
   * or null. Confluence keeps page titles unique within a space.
   *
   * @param {string} title
   * @returns {Promise<string | null>}
   */
  async findPageIdByTitle(title) {
    const query = new URLSearchParams({
      "space-id": this.requireSpaceId(),
      title,
    });
    const { results } = await this.request(`/pages?${query}`);

    return results[0]?.id ?? null;
  }

  /**
   * Creates a page with the given title and ADF body in
   * CONFLUENCE_SPACE_ID, under CONFLUENCE_PARENT_ID.
   */
  async createPage({ title, adf }) {
    return this.request("/pages", {
      method: "POST",
      body: {
        spaceId: this.requireSpaceId(),
        status: "current",
        title,
        parentId: this.requireParentId(),
        body: {
          representation: "atlas_doc_format",
          value: JSON.stringify(adf),
        },
      },
    });
  }

  /** Fetches a page's metadata and its body as ADF. */
  async getPage(pageId) {
    return this.request(`/pages/${pageId}?body-format=atlas_doc_format`);
  }

  /**
   * Overwrites a page's title and body with the given ADF document. The
   * caller must supply the page's current version number; Confluence
   * requires the new version number to be exactly one higher.
   */
  async updatePage(
    pageId,
    { title, adf, currentVersionNumber, versionMessage }
  ) {
    return this.request(`/pages/${pageId}`, {
      method: "PUT",
      body: {
        id: pageId,
        status: "current",
        title,
        body: {
          representation: "atlas_doc_format",
          value: JSON.stringify(adf),
        },
        version: {
          number: currentVersionNumber + 1,
          message: versionMessage,
        },
      },
    });
  }
}

/**
 * Returns a domain setting --create needs, or throws when the project's
 * tank.env doesn't set it.
 * @param {string} name
 * @param {string | undefined} value
 * @returns {string}
 */
function requireDomainSetting(name, value) {
  if (!value) {
    throw new Error(
      `Missing ${name} in ${PROJECT_ENV_FILE_NAME}, needed to create pages.`
    );
  }

  return value;
}

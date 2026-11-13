import {
  USER_ENV_PATH,
  loadUserEnvironment,
  readProjectEnvironment,
} from "../../shared/config.js";

loadUserEnvironment();

const REQUIRED_ENV_VARS = [
  "CONFLUENCE_BASE_URL",
  "CONFLUENCE_EMAIL",
  "CONFLUENCE_API_TOKEN",
];

/**
 * Confluence's domain settings, read only from the project's tank.env.
 * Only --create needs them, so they're checked there (see
 * ConfluenceClient), not here.
 */
export const DOMAIN_VARIABLES = [
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
];

/**
 * Reads and validates the Confluence settings: the connection settings
 * from the environment (populated from the user's credentials file, see
 * .env.example), and `spaceId` and `parentId` from the project's tank.env.
 * @returns {{ baseUrl: string, email: string, apiToken: string,
 *   spaceId?: string, parentId?: string }}
 */
export function getConfluenceConfig() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Add them to ${USER_ENV_PATH} (see .env.example in the tank repo).`
    );
  }

  const projectEnvironment = readProjectEnvironment();

  return {
    baseUrl: /** @type {string} */ (process.env.CONFLUENCE_BASE_URL).replace(
      /\/+$/,
      ""
    ),
    email: /** @type {string} */ (process.env.CONFLUENCE_EMAIL),
    apiToken: /** @type {string} */ (process.env.CONFLUENCE_API_TOKEN),
    spaceId: projectEnvironment.CONFLUENCE_SPACE_ID || undefined,
    parentId: projectEnvironment.CONFLUENCE_PARENT_ID || undefined,
  };
}

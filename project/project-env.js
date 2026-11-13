import { USER_ENV_PATH } from "../shared/config.js";
import { appendOnNewLine, formatPathFromHome } from "./project-file.js";

/** The user's credentials file, as shown in committed files. */
export const USER_ENV_DISPLAY_PATH = formatPathFromHome(USER_ENV_PATH);

/** The comment "tank init" starts the project's tank.env with. */
export const PROJECT_ENV_HEADER = `# Domain settings for tank (e.g. the Confluence space new pages go in).
# This file is committed, so never put credentials here: they go in
# ${USER_ENV_DISPLAY_PATH}.
`;

/**
 * Appends every tool's domain variable that tank.env doesn't mention yet,
 * each after a blank line, as a comment with its description and an empty
 * assignment. A variable counts as mentioned when any line assigns it,
 * even commented out, so a setting the user disabled is never added back.
 *
 * @param {string} content The current tank.env content.
 * @param {import("./tools.js").Tool[]} tools
 * @returns {string} The new content, the same when nothing is missing.
 */
export function appendMissingDomainVariables(content, tools) {
  let updatedContent = content;

  for (const tool of tools) {
    for (const variable of tool.domainVariables) {
      if (!mentionsVariable(updatedContent, variable.name)) {
        updatedContent = appendOnNewLine(
          updatedContent,
          `\n# ${variable.description}\n${variable.name}=\n`
        );
      }
    }
  }

  return updatedContent;
}

/**
 * @param {string} content
 * @param {string} variableName
 * @returns {boolean}
 */
function mentionsVariable(content, variableName) {
  return new RegExp(`^\\s*#?\\s*${variableName}\\s*=`, "m").test(content);
}

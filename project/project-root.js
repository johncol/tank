import { existsSync } from "node:fs";
import path from "node:path";
import {
  PROJECT_ENV_FILE_NAME,
  USER_ENV_PATH,
  readProjectEnvironment,
} from "../shared/config.js";
import { TOOLS } from "./tools.js";

/**
 * Checks that the folder is a tank project root, so a command never writes
 * artifacts somewhere else (e.g. inside a tool's folder): it must have a
 * tank.env, and that file must only set the tools' domain settings, since
 * it's committed.
 * @param {string} rootDir
 * @throws {Error} When the folder isn't a project root, or its tank.env
 *   sets anything else.
 */
export function assertProjectRoot(rootDir) {
  if (!existsSync(path.join(rootDir, PROJECT_ENV_FILE_NAME))) {
    throw new Error(
      `Not a tank project: ${rootDir} has no ${PROJECT_ENV_FILE_NAME}. ` +
        'Run tank from the project root, or run "tank init" to make this folder one.'
    );
  }

  const domainVariableNames = TOOLS.flatMap((tool) =>
    tool.domainVariables.map((variable) => variable.name)
  );
  const unknownNames = Object.keys(readProjectEnvironment(rootDir)).filter(
    (name) => !domainVariableNames.includes(name)
  );

  if (unknownNames.length > 0) {
    throw new Error(
      `${PROJECT_ENV_FILE_NAME} sets ${unknownNames.join(", ")}, but it only holds ` +
        `domain settings (${domainVariableNames.join(", ")}), since it's committed. ` +
        `Credentials go in ${USER_ENV_PATH}.`
    );
  }
}

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config as loadEnvFile, parse as parseEnvFile } from "dotenv";

/**
 * The user's credentials and sites, shared by every project (see
 * .env.example). Never committed anywhere.
 */
export const USER_ENV_PATH = path.join(os.homedir(), ".config", "tank", ".env");

/**
 * The project's domain settings (e.g. the Confluence space new pages go
 * in). Committed with the project, so it never holds credentials. Its
 * presence marks the project root.
 */
export const PROJECT_ENV_FILE_NAME = "tank.env";

/**
 * The project root is always the folder tank runs from: it never searches
 * parent folders, so running from a tool's folder can't nest artifacts.
 */
export function getProjectRoot() {
  return process.cwd();
}

/** @type {Set<string>} */
const loadedEnvironmentPaths = new Set();

/**
 * Loads the user's credentials file into process.env, once per file, so
 * only commands that need credentials read it. Variables already set in the
 * environment win, as with any dotenv file.
 * @param {string} [envPath] Defaults to the user's credentials file.
 */
export function loadUserEnvironment(envPath = USER_ENV_PATH) {
  if (loadedEnvironmentPaths.has(envPath)) {
    return;
  }

  loadedEnvironmentPaths.add(envPath);
  loadEnvFile({ path: envPath, quiet: true });
}

/**
 * Reads a tool's credentials from the environment, loading the user's
 * credentials file first (see `loadUserEnvironment`).
 * @param {string[]} names The variables the tool needs, all required.
 * @returns {Record<string, string>} Each variable's value, keyed by name.
 * @throws {Error} When any of them is missing, naming every missing one.
 */
export function readUserVariables(names) {
  loadUserEnvironment();

  const missingNames = names.filter((name) => !process.env[name]);

  if (missingNames.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missingNames.join(", ")}. ` +
        `Add them to ${USER_ENV_PATH} (see .env.example in the tank repo).`
    );
  }

  return Object.fromEntries(
    names.map((name) => [name, /** @type {string} */ (process.env[name])])
  );
}

/**
 * Reads the project's tank.env as a plain object. Domain settings are read
 * only from this file, never from the environment or the user's file, so a
 * setting from one project can't leak into another.
 * @param {string} [rootDir] Defaults to the project root.
 * @returns {Record<string, string>}
 */
export function readProjectEnvironment(rootDir = getProjectRoot()) {
  return parseEnvFile(
    readFileSync(path.join(rootDir, PROJECT_ENV_FILE_NAME), "utf8")
  );
}

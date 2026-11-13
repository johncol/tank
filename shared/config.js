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

/**
 * Loads the user's credentials file into process.env. Variables already
 * set in the environment win, as with any dotenv file.
 */
export function loadUserEnvironment() {
  loadEnvFile({ path: USER_ENV_PATH });
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

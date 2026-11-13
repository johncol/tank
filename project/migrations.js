import { getErrorMessage } from "../shared/error.js";

/**
 * A change to a project's files that a new version of tank needs.
 * @typedef {Object} Migration
 * @property {string} name What it changes, shown in its result.
 * @property {(rootDir: string) => Promise<boolean>} isNeeded Whether the
 *   project still has the old format.
 * @property {(rootDir: string) => Promise<void>} run Moves the project to
 *   the new format.
 */

/**
 * Every migration "tank upgrade" runs, oldest first.
 *
 * Changes to tank should stay backward compatible with existing projects.
 * When a change must break a project's files, it ships with:
 * - a migration here, idempotent, that detects for itself whether it
 *   applies (projects store no tank version), and a test for it;
 * - a check in the sync commands that meets the old format and fails,
 *   asking to run "tank upgrade".
 *
 * @type {Migration[]}
 */
export const MIGRATIONS = [];

/**
 * Runs, in order, every migration the project needs.
 *
 * @param {string} rootDir The project root.
 * @param {string} action The command's action, reported in each result.
 * @param {Migration[]} [migrations] Defaults to every tank migration.
 * @returns {Promise<Object[]>} One result per migration that ran.
 * @throws {Error} When a migration fails, since later steps may rely on the
 *   new format.
 */
export async function runMigrations(rootDir, action, migrations = MIGRATIONS) {
  const results = [];

  for (const migration of migrations) {
    if (!(await migration.isNeeded(rootDir))) {
      continue;
    }

    try {
      await migration.run(rootDir);
    } catch (error) {
      throw new Error(
        `Migration "${migration.name}" failed: ${getErrorMessage(error)}`,
        { cause: error }
      );
    }

    results.push({
      action,
      status: "success",
      message: `Ran migration "${migration.name}".`,
    });
  }

  return results;
}

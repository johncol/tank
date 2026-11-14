import {
  findEntryById,
  listManifestEntries,
} from "../../../shared/manifest.js";
import { fetchOne } from "../../../shared/actions.js";

/**
 * Fetches every test in the given suite that isn't tracked yet, into the
 * suite's folder. Tests that are already tracked are left alone: pull them
 * to refresh them (and move them, if their suite membership changed).
 * `--force` never carries over to these tests (see CONVENTIONS.md).
 *
 * Reads entries from the manifest document itself, rather than a snapshot,
 * so it sees the suite's own entry and tests fetched by an earlier suite in
 * the same run.
 *
 * @param {any} client
 * @param {any} document
 * @param {{ tests?: { public_id: string }[] }} suite
 * @param {import("../../../shared/actions.js").Adapter} testAdapter The
 *   synthetic test adapter, with the suite's rootDir.
 * @returns {Promise<Object[]>} One fetch result per untracked test.
 */
export async function fetchUntrackedMemberTests(
  client,
  document,
  suite,
  testAdapter
) {
  const results = [];

  for (const { public_id: testId } of suite.tests ?? []) {
    if (
      findEntryById(listManifestEntries(document), testAdapter.kind, testId)
    ) {
      continue;
    }

    results.push(
      ...(await fetchOne(testAdapter, client, document, testId, {
        force: false,
      }))
    );
  }

  return results;
}

import path from "node:path";
import {
  loadManifest as loadManifestFile,
  saveManifest as saveManifestFile,
  listManifestEntries,
  updateManifestEntry,
  removeManifestEntry,
  isPathTracked,
  findEntryById,
  MANIFEST_FILE_NAME,
} from "../../shared/manifest.js";
import { getProjectRoot } from "../../shared/config.js";

export {
  listManifestEntries,
  updateManifestEntry,
  removeManifestEntry,
  isPathTracked,
  findEntryById,
};

export const DATADOG_DIR = path.join(getProjectRoot(), "datadog");
const MANIFEST_PATH = path.join(DATADOG_DIR, MANIFEST_FILE_NAME);

/**
 * The comment block at the top of the manifest, documenting its fields.
 * tank owns it: "tank init" writes it, and "tank upgrade" rewrites it.
 */
export const MANIFEST_HEADER = `# Source of truth for which datadog artifacts (dashboards, log-based
# metrics, and synthetic tests and suites) are synced with which Datadog
# objects. Read and written by tank ("tank datadog"), which also owns this
# header: "tank upgrade" rewrites it, and never touches the entries.
#
# Each entry is keyed by the local file's path and holds:
#   kind: "dashboard", "log-metric", "synthetic-test", or "synthetic-suite".
#   title: the dashboard title or test/suite name. Log metrics have no
#     title, so it repeats the metric ID.
#   id: the Datadog public ID, or the metric name for log metrics.
#   lastSyncedAt: when a sync last changed the file or Datadog.
#   remoteVersion: Datadog's modified_at at the last sync. Log metrics have
#     no modified_at, so it holds a hash of the metric definition instead.
#     A push compares the live value against it before overwriting (a purely
#     client-side check: Datadog has no optimistic concurrency).
#   contentHash: hash of the local file at the last sync.
`;

/** Loads sync-manifest.yaml, exposing each entry as `{ path, ...fields }`. */
export async function loadManifest() {
  return loadManifestFile(MANIFEST_PATH);
}

/** Writes the given manifest document back to sync-manifest.yaml. */
export async function saveManifest(document) {
  await saveManifestFile(document, MANIFEST_PATH);
}

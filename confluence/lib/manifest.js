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

export const CONFLUENCE_DIR = path.join(getProjectRoot(), "confluence");
const MANIFEST_PATH = path.join(CONFLUENCE_DIR, MANIFEST_FILE_NAME);

/**
 * The comment block at the top of the manifest, documenting its fields.
 * tank owns it: "tank init" writes it, and "tank upgrade" rewrites it.
 */
export const MANIFEST_HEADER = `# Source of truth for which markdown docs are synced with which Confluence
# pages. Read and written by tank ("tank confluence"), which also owns this
# header: "tank upgrade" rewrites it, and never touches the entries.
#
# Each entry is keyed by the markdown file's path and holds:
#   kind: always "page".
#   title: the page title.
#   id: the Confluence page ID.
#   lastSyncedAt: when a sync last changed the file or the page.
#   remoteVersion: the page's Confluence version number at the last sync. A
#     push compares the live version against it to detect upstream edits.
#   contentHash: hash of the markdown file at the last sync.
`;

/** Resolves an artifact path from the manifest (e.g. "synced/datadog.md")
 * into an absolute filesystem path. */
export function resolveArtifactPath(artifactPath) {
  return path.join(CONFLUENCE_DIR, artifactPath);
}

/** Loads sync-manifest.yaml, exposing each entry as `{ path, ...fields }`. */
export async function loadManifest() {
  return loadManifestFile(MANIFEST_PATH);
}

/** Writes the given manifest document back to sync-manifest.yaml. */
export async function saveManifest(document) {
  await saveManifestFile(document, MANIFEST_PATH);
}

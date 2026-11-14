import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument, Scalar } from "yaml";

/** Every tool's manifest, in the tool's folder at the project root. */
export const MANIFEST_FILE_NAME = "sync-manifest.yaml";

/**
 * Loads a sync manifest YAML file as a mutable YAML document so header
 * comments and formatting survive round-trip edits, alongside a plain-array
 * view of its entries for easy reading (see `listManifestEntries`).
 */
export async function loadManifest(manifestPath) {
  const raw = await readFile(manifestPath, "utf8");

  return parseManifest(raw, manifestPath);
}

/**
 * Parses a sync manifest's YAML text (see `loadManifest`). Throws if the
 * YAML has errors (e.g. merge conflict markers or duplicate keys), since
 * the YAML parser doesn't: it would return junk entries, and the error
 * would only surface when saving, after the action wrote to the remote.
 */
export function parseManifest(raw, manifestPath) {
  const document = parseDocument(raw);

  if (document.errors.length > 0) {
    throw new Error(
      `${manifestPath} can't be parsed (merge conflict?): ${document.errors[0].message}. Fix it, then run again.`
    );
  }

  return {
    document,
    entries: listManifestEntries(document),
  };
}

/**
 * Lists the entries currently in the given manifest document as
 * `{ path, kind, title, id, lastSyncedAt, remoteVersion, contentHash }`,
 * where `path` is the entry's top-level YAML key (the local file's path,
 * relative to the tool's folder). Includes any entries added or changed
 * since the document was loaded.
 */
export function listManifestEntries(document) {
  return Object.entries(document.toJS() ?? {}).map(([path, fields]) => ({
    path,
    ...fields,
  }));
}

/** Writes the given manifest document back to the given manifest path. */
export async function saveManifest(document, manifestPath) {
  await writeFile(manifestPath, String(document), "utf8");
}

/**
 * Applies a partial update to one entry's fields in the manifest document,
 * keyed by `key` (the entry's top-level YAML key). String values are written
 * as explicitly double-quoted scalars so fields like content hashes and
 * timestamps always render the same way, whether updating an existing entry
 * or creating a brand-new one (left to its own defaults, the YAML writer
 * only quotes a new plain string when it judges quoting necessary to avoid
 * ambiguity with another YAML type).
 */
export function updateManifestEntry(document, key, patch) {
  for (const [field, value] of Object.entries(patch)) {
    if (typeof value === "string") {
      const scalar = new Scalar(value);
      scalar.type = Scalar.QUOTE_DOUBLE;
      document.setIn([key, field], scalar);
    } else {
      document.setIn([key, field], value);
    }
  }
}

/** Removes one entry from the manifest document, keyed by `key` (the
 * entry's top-level YAML key). */
export function removeManifestEntry(document, key) {
  document.delete(key);
}

/** Returns whether an entry in the manifest document is keyed by `key`
 * (i.e. already tracks that path), including entries added since it was
 * loaded. */
export function isPathTracked(document, key) {
  return document.has(key);
}

/** Finds the manifest entry whose given field matches the given value,
 * comparing as strings (so numeric and string lookups both match). */
export function findEntryByField(entries, fieldName, value) {
  return entries.find((entry) => String(entry[fieldName]) === String(value));
}

/** Finds the manifest entry of the given kind (e.g. "dashboard") tracking
 * the given remote ID, comparing IDs as strings (so numeric and string
 * lookups both match). */
export function findEntryById(entries, kind, id) {
  return entries.find(
    (entry) => entry.kind === kind && String(entry.id) === String(id)
  );
}

/**
 * Finds every manifest entry whose file name matches the given name, with
 * or without the file's extension (e.g. "datadog" or "datadog.md" for
 * "synced/datadog.md"). Files in different folders can share a name, so
 * this can match more than one entry.
 */
export function findEntriesByFileName(entries, name) {
  return entries.filter((entry) => {
    const fileName = path.posix.basename(entry.path);
    const extension = path.posix.extname(fileName);

    return name === fileName || name === fileName.slice(0, -extension.length);
  });
}

import { isPathTracked } from "./manifest.js";

/**
 * Converts a title into a filesystem-friendly slug, e.g.
 * "Decisions Log" -> "decisions-log".
 */
export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Builds the path a new artifact is fetched into from its title, e.g.
 * "Homepage (US)" -> `buildPath("homepage-us")`. The remote ID keeps the
 * path unique when the title's slug is empty (`buildPath("abc-123")`) or its
 * path is taken by another artifact (`buildPath("homepage-us-abc-123")`).
 * Only for new paths: a tracked artifact keeps the path it has.
 *
 * @param {{ title: string, id: string | number,
 *   buildPath: (name: string) => string,
 *   isPathTaken: (artifactPath: string) => boolean }} options
 * @returns {string}
 */
export function buildTitledPath({ title, id, buildPath, isPathTaken }) {
  const titleSlug = slugify(title);
  const idSlug = slugify(String(id));

  if (titleSlug === "") {
    return buildPath(idSlug);
  }

  const titledPath = buildPath(titleSlug);

  if (!isPathTaken(titledPath)) {
    return titledPath;
  }

  return buildPath(`${titleSlug}-${idSlug}`);
}

/**
 * Creates an adapter's `buildFetchPath` for artifacts kept as
 * `<folder>/<name><extension>`: named from the --name file name when given,
 * or else from the remote's title (see `buildTitledPath`).
 *
 * @param {string} folder The manifest-relative folder, e.g. "synced".
 * @param {string} extension e.g. ".md".
 * @returns {(context: { document: any, id: string, remote: { title: string },
 *   fileName?: string }) => string}
 */
export function createTitledFetchPath(folder, extension) {
  const buildPath = (name) => `${folder}/${name}${extension}`;

  return ({ document, id, remote, fileName }) => {
    if (fileName !== undefined) {
      return buildPath(fileName);
    }

    return buildTitledPath({
      title: remote.title,
      id,
      buildPath,
      isPathTaken: (artifactPath) => isPathTracked(document, artifactPath),
    });
  };
}

const KEBAB_CASE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validates a user-supplied file name override (e.g. the --name CLI flag),
 * accepting kebab-case names with or without a trailing extension (e.g.
 * ".md" or ".json", as given by `extension`). Returns the base name without
 * the extension if valid, or null if the name isn't kebab-case.
 */
export function parseKebabCaseName(name, extension) {
  const withoutExtension = name.endsWith(extension)
    ? name.slice(0, -extension.length)
    : name;

  return KEBAB_CASE_PATTERN.test(withoutExtension) ? withoutExtension : null;
}

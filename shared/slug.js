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

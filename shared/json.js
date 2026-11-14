/** Serializes a value as pretty-printed JSON with a trailing newline, so
 * tracked files stay human-readable and diff cleanly. Changing this output
 * changes every tracked file's content hash. */
export function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Returns a shallow copy of `object` without the given top-level fields,
 * e.g. the read-only metadata an API returns but doesn't accept back.
 * Nested objects are shared with the input, which isn't mutated. */
export function omitFields(object, fields) {
  const copy = { ...object };

  for (const field of fields) {
    delete copy[field];
  }

  return copy;
}

/**
 * Returns a caught value's message if it's an Error instance, otherwise a
 * reasonable string fallback. Narrows the `unknown` type TypeScript assigns
 * to caught errors.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Returns a caught value's `status` property (e.g. an HTTP status code
 * attached to request failures by DatadogClient/ConfluenceClient), or
 * undefined if it isn't present.
 *
 * @param {unknown} error
 * @returns {number | undefined}
 */
export function getErrorStatus(error) {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return undefined;
}

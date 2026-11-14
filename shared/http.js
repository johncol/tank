import { setTimeout as sleep } from "node:timers/promises";

const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 1;
const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 60_000;

/**
 * Sends a JSON API request, shared by the Confluence and Datadog clients so
 * both handle rate limits and errors the same way:
 * - retries a 429 up to 3 times, waiting for the number of seconds the
 *   `rateLimitResetHeader` response header reports (1 second if absent).
 * - throws an Error carrying the HTTP `status` (see shared/error.js
 *   getErrorStatus) for any other non-2xx response.
 * - gives each attempt its own timeout, and rethrows network failures and
 *   timeouts with the method, host, and path of the request.
 * - resolves to the parsed JSON body, or null for an empty body (e.g. a 204),
 *   and throws a descriptive Error when the body is not JSON.
 *
 * @param {string} url
 * @param {Object} options
 * @param {string} options.serviceName Names the API in error messages, e.g. "Datadog".
 * @param {Record<string, string>} options.headers
 * @param {string} options.rateLimitResetHeader e.g. "x-ratelimit-reset" or "retry-after".
 * @param {string} [options.method]
 * @param {unknown} [options.body]
 * @param {number} [options.rateLimitWaitMultiplier] Lets tests skip the real wait.
 * @param {number} [options.timeoutMilliseconds] Per-attempt timeout.
 */
export async function requestJson(
  url,
  {
    serviceName,
    headers,
    rateLimitResetHeader,
    method = "GET",
    body,
    rateLimitWaitMultiplier = 1,
    timeoutMilliseconds = DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
  }
) {
  const { host, pathname } = new URL(url);
  const requestDescription = `${serviceName} API ${method} ${host}${pathname}`;

  /** @type {Response | undefined} */
  let response;
  let responseText = "";

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...headers,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMilliseconds),
      });
      // The timeout also covers reading the body, so read it in the same attempt.
      responseText = await response.text();
    } catch (error) {
      throw new Error(
        `${requestDescription} failed: ${describeNetworkError(error, timeoutMilliseconds)}`,
        { cause: error }
      );
    }

    if (response.status !== 429 || attempt === MAX_RATE_LIMIT_RETRIES) {
      break;
    }

    const resetSeconds =
      Number(response.headers.get(rateLimitResetHeader)) ||
      DEFAULT_RATE_LIMIT_WAIT_SECONDS;
    await sleep(resetSeconds * 1000 * rateLimitWaitMultiplier);
  }

  if (!response) {
    // Unreachable: the loop above always runs at least once.
    throw new Error(`${serviceName} API request never executed`);
  }

  if (!response.ok) {
    throw Object.assign(
      new Error(
        `${serviceName} API ${method} ${pathname} failed with ${response.status}: ${responseText}`
      ),
      { status: response.status }
    );
  }

  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch (error) {
    const contentType = response.headers.get("content-type") ?? "unknown";

    throw new Error(
      `${requestDescription} returned a response that is not JSON ` +
        `(content-type: ${contentType}). Check that the ${serviceName} base URL setting is correct.`,
      { cause: error }
    );
  }
}

/**
 * Explains why fetch rejected: a timeout, or the underlying network cause
 * (fetch itself only says "fetch failed").
 * @param {unknown} error
 * @param {number} timeoutMilliseconds
 * @returns {string}
 */
function describeNetworkError(error, timeoutMilliseconds) {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `timed out after ${timeoutMilliseconds / 1000}s`;
  }

  if (error instanceof Error) {
    const cause = /** @type {{ message?: string } | undefined} */ (error.cause);

    return cause?.message ?? error.message;
  }

  return String(error);
}

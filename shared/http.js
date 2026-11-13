import { setTimeout as sleep } from "node:timers/promises";

const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 1;

/**
 * Sends a JSON API request, shared by the Confluence and Datadog clients so
 * both handle rate limits and errors the same way:
 * - retries a 429 up to 3 times, waiting for the number of seconds the
 *   `rateLimitResetHeader` response header reports (1 second if absent).
 * - throws an Error carrying the HTTP `status` (see shared/error.js
 *   getErrorStatus) for any other non-2xx response.
 * - resolves to the parsed JSON body, or null for an empty body (e.g. a 204).
 *
 * @param {string} url
 * @param {Object} options
 * @param {string} options.serviceName Names the API in error messages, e.g. "Datadog".
 * @param {Record<string, string>} options.headers
 * @param {string} options.rateLimitResetHeader e.g. "x-ratelimit-reset" or "retry-after".
 * @param {string} [options.method]
 * @param {unknown} [options.body]
 * @param {number} [options.rateLimitWaitMultiplier] Lets tests skip the real wait.
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
  }
) {
  /** @type {Response | undefined} */
  let response;

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

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

  const responseText = await response.text();

  if (!response.ok) {
    const path = new URL(url).pathname;

    throw Object.assign(
      new Error(
        `${serviceName} API ${method} ${path} failed with ${response.status}: ${responseText}`
      ),
      { status: response.status }
    );
  }

  return responseText ? JSON.parse(responseText) : null;
}

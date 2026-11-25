import test from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "../http.js";

const URL = "https://example.com/api/v2/thing";

function request(options = {}) {
  return requestJson(URL, {
    serviceName: "Example",
    headers: {},
    rateLimitResetHeader: "x-ratelimit-reset",
    rateLimitWaitMultiplier: 0,
    ...options,
  });
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

test("requestJson retries after a 429 and returns the eventual successful response", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch");
  fetchMock.mock.mockImplementationOnce(
    async () => jsonResponse(429, {}, { "x-ratelimit-reset": "3" }),
    0
  );
  fetchMock.mock.mockImplementationOnce(
    async () => jsonResponse(200, { data: { id: "mrt.test" } }),
    1
  );

  assert.deepEqual(await request(), { data: { id: "mrt.test" } });
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("requestJson gives up and throws once it runs out of rate-limit retries", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(429, { errors: ["Too many requests"] })
  );

  await assert.rejects(
    request(),
    /Example API GET \/api\/v2\/thing failed with 429/
  );
  assert.equal(
    fetchMock.mock.callCount(),
    4,
    "one initial attempt plus 3 retries"
  );
});

test("requestJson resolves to null for a response with no body (e.g. a 204 from DELETE)", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 204 })
  );

  assert.equal(await request({ method: "DELETE" }), null);
});

test("requestJson exposes the HTTP status on the thrown error", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(404, { errors: ["Not found"] })
  );

  await assert.rejects(request(), (error) => error.status === 404);
});

test("requestJson names the request and the underlying cause when the network fails", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed", {
      cause: new Error("getaddrinfo ENOTFOUND example.com"),
    });
  });

  await assert.rejects(request(), {
    message:
      "Example API GET example.com/api/v2/thing failed: getaddrinfo ENOTFOUND example.com",
  });
});

test("requestJson explains a successful response whose body is not JSON", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
  );

  await assert.rejects(
    request(),
    /Example API GET example\.com\/api\/v2\/thing returned a response that is not JSON \(content-type: text\/html\)\. Check that the Example base URL/
  );
});

test("requestJson times out a stuck request", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      })
  );

  // AbortSignal.timeout doesn't keep the event loop alive, so on some Node
  // versions the runner gives up on the pending promise before the timeout fires.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(request({ timeoutMilliseconds: 10 }), {
      message:
        "Example API GET example.com/api/v2/thing failed: timed out after 0.01s",
    });
  } finally {
    clearInterval(keepAlive);
  }
});

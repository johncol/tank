import { requestJson } from "../../shared/http.js";
import { USER_ENV_PATH, readUserVariables } from "../../shared/config.js";

/**
 * Reads and validates the Datadog connection settings from the environment
 * (populated from the user's credentials file, see .env.example). Datadog
 * has no domain settings: everything it needs is a credential.
 * @returns {{ site: string, apiKey: string, appKey: string }}
 */
function readDatadogConfig() {
  const variables = readUserVariables([
    "DATADOG_API_KEY",
    "DATADOG_APP_KEY",
    "DATADOG_SITE",
  ]);

  if (/^https?:\/\//i.test(variables.DATADOG_SITE)) {
    throw new Error(
      `DATADOG_SITE must be a bare domain such as "datadoghq.com", without http:// or https://. ` +
        `Fix it in ${USER_ENV_PATH}.`
    );
  }

  return {
    site: variables.DATADOG_SITE.replace(/\/+$/, ""),
    apiKey: variables.DATADOG_API_KEY,
    appKey: variables.DATADOG_APP_KEY,
  };
}

/** The synthetic test types whose create and edit endpoints this client
 * supports. */
const SUPPORTED_TEST_TYPES = ["api", "browser"];

function assertSupportedTestType(type, verb) {
  if (!SUPPORTED_TEST_TYPES.includes(type)) {
    throw new Error(
      `${verb} synthetic tests of type "${type}" isn't supported, only "api" and "browser".`
    );
  }
}

/**
 * Thin wrapper around the Datadog API endpoints for dashboards (v1),
 * log-based metrics (v2), monitors (v1), synthetic tests (v1), and synthetic
 * suites (v2). Unlike
 * Confluence, Datadog authenticates with two static keys (an API key
 * identifying the org, and an application key identifying the caller's
 * permissions) rather than a per-request token exchange, and its dashboard
 * API has no integer version field for optimistic concurrency -- only a
 * `modified_at` timestamp, which this client's callers use for a purely
 * client-side conflict check.
 */
export class DatadogClient {
  constructor(
    config = readDatadogConfig(),
    { rateLimitWaitMultiplier = 1 } = {}
  ) {
    this.baseUrl = `https://api.${config.site}`;
    this.apiKey = config.apiKey;
    this.appKey = config.appKey;
    // Lets tests skip the real rate-limit wait.
    this.rateLimitWaitMultiplier = rateLimitWaitMultiplier;
  }

  /**
   * Sends a request (see shared/http.js for rate-limit retries and errors).
   * Limits are low on some endpoints (e.g. 20 log-based metric reads per 10
   * seconds), so bulk pulls/pushes hit them.
   *
   * @param path
   * @param {Object} [options]
   * @param {string} [options.method]
   * @param {unknown} [options.body]
   * @param {string} [options.apiVersion]
   */
  async request(path, { method = "GET", body, apiVersion = "v1" } = {}) {
    return requestJson(`${this.baseUrl}/api/${apiVersion}${path}`, {
      serviceName: "Datadog",
      headers: {
        "DD-API-KEY": /** @type {string} */ (this.apiKey),
        "DD-APPLICATION-KEY": /** @type {string} */ (this.appKey),
      },
      rateLimitResetHeader: "x-ratelimit-reset",
      method,
      body,
      rateLimitWaitMultiplier: this.rateLimitWaitMultiplier,
    });
  }

  /** Fetches a dashboard's full definition, including read-only fields like
   * `id`, `author_handle`, and `modified_at`. */
  async getDashboard(dashboardId) {
    return this.request(`/dashboard/${dashboardId}`);
  }

  /** Overwrites a dashboard with the given definition. Datadog's update
   * endpoint has no server-side optimistic concurrency check: it always
   * applies the write, regardless of whether the dashboard changed since it
   * was last read. */
  async updateDashboard(dashboardId, dashboard) {
    return this.request(`/dashboard/${dashboardId}`, {
      method: "PUT",
      body: dashboard,
    });
  }

  /** Fetches a log-based metric's definition. The response has no
   * modified_at or version field, only the metric's `id` (its name) and
   * `attributes` (filter, group_by, compute). */
  async getLogMetric(metricId) {
    const response = await this.request(
      `/logs/config/metrics/${encodeURIComponent(metricId)}`,
      { apiVersion: "v2" }
    );

    return response.data;
  }

  /** Updates a log-based metric's filter and group_by. Datadog rejects any
   * change to `compute` (it's fixed at creation), and like dashboards,
   * there's no server-side optimistic concurrency check. */
  async updateLogMetric(metricId, { filter, group_by }) {
    const response = await this.request(
      `/logs/config/metrics/${encodeURIComponent(metricId)}`,
      {
        method: "PATCH",
        apiVersion: "v2",
        body: {
          data: { type: "logs_metrics", attributes: { filter, group_by } },
        },
      }
    );

    return response.data;
  }

  /** Creates a log-based metric named `metricId`. Datadog responds with 409
   * if a metric with that name already exists. */
  async createLogMetric(metricId, { filter, group_by, compute }) {
    const response = await this.request("/logs/config/metrics", {
      method: "POST",
      apiVersion: "v2",
      body: {
        data: {
          id: metricId,
          type: "logs_metrics",
          attributes: { filter, group_by, compute },
        },
      },
    });

    return response.data;
  }

  /** Deletes a log-based metric. Its history in Datadog is lost. */
  async deleteLogMetric(metricId) {
    await this.request(`/logs/config/metrics/${encodeURIComponent(metricId)}`, {
      method: "DELETE",
      apiVersion: "v2",
    });
  }

  /** Fetches a monitor's full definition, including read-only fields like
   * `id`, `creator`, and `modified`, and its live `overall_state`. */
  async getMonitor(monitorId) {
    return this.request(`/monitor/${monitorId}`);
  }

  /** Overwrites a monitor with the given definition. Like dashboards, there's
   * no server-side optimistic concurrency check. The response holds the new
   * `modified`, but not the same fields as getMonitor (e.g. no `creator`). */
  async updateMonitor(monitorId, monitor) {
    return this.request(`/monitor/${monitorId}`, {
      method: "PUT",
      body: monitor,
    });
  }

  /** Lists the monitors whose name contains `name` (Datadog matches part of
   * the name, ignoring case), one page at a time. */
  async listMonitorsByName(name) {
    const pageSize = 100;
    const monitors = [];

    for (let pageNumber = 0; ; pageNumber += 1) {
      const page = await this.request(
        `/monitor?name=${encodeURIComponent(name)}&page_size=${pageSize}&page=${pageNumber}`
      );

      monitors.push(...page);

      if (page.length < pageSize) {
        return monitors;
      }
    }
  }

  /** Creates a monitor from the given definition and returns it, with the
   * `id` Datadog assigned. Like updateMonitor, the response's fields differ
   * from getMonitor's. */
  async createMonitor(monitor) {
    return this.request("/monitor", { method: "POST", body: monitor });
  }

  /** Deletes a monitor. Datadog refuses if other resources (e.g. SLOs or
   * composite monitors) still depend on it. */
  async deleteMonitor(monitorId) {
    await this.request(`/monitor/${monitorId}`, { method: "DELETE" });
  }

  /** Fetches a synthetic test's full definition (any type), including
   * read-only fields like `public_id`, `creator`, and `modified_at`. */
  async getSyntheticTest(testId) {
    return this.request(`/synthetics/tests/${testId}`);
  }

  /** Lists the suites that include the given synthetic test, as
   * `[{ public_id, name }]`. A test can belong to zero, one, or many suites. */
  async getSyntheticTestParentSuites(testId) {
    const response = await this.request(
      `/synthetics/tests/${testId}/parent-suites`,
      { apiVersion: "v2" }
    );

    return response.data.map((parentSuite) => ({
      public_id: parentSuite.attributes.public_id,
      name: parentSuite.attributes.name,
    }));
  }

  /** Lists every synthetic test (any type), as Datadog's summaries (with
   * `public_id`, `name`, and `type`), one page at a time. */
  async listSyntheticTests() {
    const pageSize = 100;
    const tests = [];

    for (let pageNumber = 0; ; pageNumber += 1) {
      const response = await this.request(
        `/synthetics/tests?page_size=${pageSize}&page_number=${pageNumber}`
      );

      tests.push(...response.tests);

      if (response.tests.length < pageSize) {
        return tests;
      }
    }
  }

  /** Creates a synthetic test from the given definition and returns it,
   * with the `public_id` Datadog assigned. Like edits, the endpoint depends
   * on the test's type. */
  async createSyntheticTest(test) {
    assertSupportedTestType(test.type, "Creating");

    return this.request(`/synthetics/tests/${test.type}`, {
      method: "POST",
      body: test,
    });
  }

  /** Overwrites a synthetic test with the given definition. Datadog's edit
   * endpoint depends on the test's type ("api" or "browser"), and, like
   * dashboards, has no server-side optimistic concurrency check. */
  async updateSyntheticTest(testId, test) {
    assertSupportedTestType(test.type, "Pushing");

    return this.request(`/synthetics/tests/${test.type}/${testId}`, {
      method: "PUT",
      body: test,
    });
  }

  /** Deletes a synthetic test. Datadog refuses if other resources (e.g. SLOs
   * or composite monitors) still depend on it. */
  async deleteSyntheticTest(testId) {
    await this.request("/synthetics/tests/delete", {
      method: "POST",
      body: { public_ids: [testId], force_delete_dependencies: false },
    });
  }

  /** Fetches a synthetic suite's `attributes`: its definition (name, tests,
   * options, ...) plus read-only fields like `public_id` and `modified_at`. */
  async getSyntheticSuite(suiteId) {
    const response = await this.request(`/synthetics/suites/${suiteId}`, {
      apiVersion: "v2",
    });

    return response.data.attributes;
  }

  /** Overwrites a synthetic suite with the given definition (its
   * `attributes`). No server-side optimistic concurrency check either. */
  async updateSyntheticSuite(suiteId, suite) {
    const response = await this.request(`/synthetics/suites/${suiteId}`, {
      method: "PUT",
      apiVersion: "v2",
      body: { data: { type: "suites", attributes: suite } },
    });

    return response.data.attributes;
  }

  /** Deletes a synthetic suite. Its tests aren't deleted. */
  async deleteSyntheticSuite(suiteId) {
    await this.request("/synthetics/suites/bulk-delete", {
      method: "POST",
      apiVersion: "v2",
      body: {
        data: {
          type: "delete_suites_request",
          attributes: {
            public_ids: [suiteId],
            force_delete_dependencies: false,
          },
        },
      },
    });
  }
}

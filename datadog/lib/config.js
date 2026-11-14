import { USER_ENV_PATH, loadUserEnvironment } from "../../shared/config.js";

const REQUIRED_ENV_VARS = [
  "DATADOG_API_KEY",
  "DATADOG_APP_KEY",
  "DATADOG_SITE",
];

/** Datadog has no domain settings: everything it needs is a credential. */
export const DOMAIN_VARIABLES = [];

/**
 * Reads and validates the Datadog connection settings from the environment
 * (populated from the user's credentials file, see .env.example).
 * @returns {{ site: string, apiKey: string, appKey: string }}
 */
export function getDatadogConfig() {
  loadUserEnvironment();

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Add them to ${USER_ENV_PATH} (see .env.example in the tank repo).`
    );
  }

  if (/^https?:\/\//i.test(/** @type {string} */ (process.env.DATADOG_SITE))) {
    throw new Error(
      `DATADOG_SITE must be a bare domain such as "datadoghq.com", without http:// or https://. ` +
        `Fix it in ${USER_ENV_PATH}.`
    );
  }

  return {
    site: /** @type {string} */ (process.env.DATADOG_SITE).replace(/\/+$/, ""),
    apiKey: /** @type {string} */ (process.env.DATADOG_API_KEY),
    appKey: /** @type {string} */ (process.env.DATADOG_APP_KEY),
  };
}

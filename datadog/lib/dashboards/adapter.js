import { formatJson, omitFields } from "../../../shared/json.js";
import { READ_ONLY_DASHBOARD_FIELDS } from "./dashboard.js";
import { createTitledFetchPath } from "../../../shared/slug.js";

const DASHBOARDS_PATH = "synced/dashboards";

/**
 * Plugs Datadog dashboards into the shared action engine
 * (shared/actions.js). Files are named from the dashboard title, unless a
 * file name is given on fetch.
 *
 * Datadog's dashboard API has no server-side optimistic concurrency, so the
 * engine's `modified_at` check is the only thing stopping a push from
 * overwriting a dashboard edited in Datadog since the last sync.
 *
 * @type {import("../../../shared/actions.js").AdapterDefinition}
 */
export const dashboardAdapter = {
  kind: "dashboard",
  label: "Datadog dashboard",
  systemName: "Datadog",
  actions: ["fetch", "pull", "push", "delete"],
  allowsFileName: true,
  usageNote: "Its ID is the dashboard ID.",
  fileNameSuffix: ".json",

  async getRemote(client, id) {
    return client.getDashboard(id);
  },

  describeRemote(dashboard) {
    return {
      title: dashboard.title,
      remoteVersion: dashboard.modified_at,
      content: formatJson(omitFields(dashboard, READ_ONLY_DASHBOARD_FIELDS)),
    };
  },

  buildFetchPath: createTitledFetchPath(DASHBOARDS_PATH, ".json"),

  async updateRemote(client, entry, content) {
    return client.updateDashboard(entry.id, JSON.parse(content));
  },

  async deleteRemote(client, id) {
    await client.deleteDashboard(id);
  },
};

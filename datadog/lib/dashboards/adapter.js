import { formatJson, omitFields } from "../../../shared/json.js";
import {
  READ_ONLY_DASHBOARD_FIELDS,
  findReadOnlyDashboardFields,
} from "./dashboard.js";
import { createTitledFetchPath } from "../../../shared/slug.js";

const DASHBOARDS_PATH = "synced/dashboards";
const DASHBOARD_FILE_EXTENSION = ".json";

/**
 * Plugs Datadog dashboards into the shared action engine
 * (shared/actions.js). Files are named from the dashboard title, unless a
 * file name is given on fetch.
 *
 * Datadog's dashboard API has no server-side optimistic concurrency, so the
 * engine's `modified_at` check is the only thing stopping a push from
 * overwriting a dashboard edited in Datadog since the last sync.
 *
 * Datadog assigns a new dashboard's ID, so --create takes a file name.
 *
 * @type {import("../../../shared/actions.js").AdapterDefinition}
 */
export const dashboardAdapter = {
  kind: "dashboard",
  label: "Datadog dashboard",
  systemName: "Datadog",
  actions: ["fetch", "pull", "push", "create", "delete"],
  allowsFileName: true,
  fileNameSuffix: DASHBOARD_FILE_EXTENSION,
  assignsIdOnCreate: true,
  usageNote: "Its ID is the dashboard ID.",

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

  buildFetchPath: createTitledFetchPath(
    DASHBOARDS_PATH,
    DASHBOARD_FILE_EXTENSION
  ),

  async updateRemote(client, entry, content) {
    return client.updateDashboard(entry.id, JSON.parse(content));
  },

  buildCreatePath({ fileName }) {
    return `${DASHBOARDS_PATH}/${fileName}${DASHBOARD_FILE_EXTENSION}`;
  },

  // Datadog doesn't enforce unique dashboard titles, so a same-titled
  // dashboard is the only way to catch a create that already ran (e.g.
  // retried after a timeout).
  async findRemoteIdByContent(client, content) {
    const { title } = JSON.parse(content);
    const sameTitledDashboard = (await client.listDashboards()).find(
      (dashboard) => dashboard.title === title
    );

    return sameTitledDashboard?.id ?? null;
  },

  async createRemote(client, id, content) {
    const dashboard = JSON.parse(content);
    const readOnlyFields = findReadOnlyDashboardFields(dashboard);

    if (readOnlyFields.length > 0) {
      throw new Error(
        `Remove ${readOnlyFields.join(", ")} from the file: Datadog sets them.`
      );
    }

    const createdDashboard = await client.createDashboard(dashboard);

    // Read it back, as a pull would, for the file to match the next pull.
    return client.getDashboard(createdDashboard.id);
  },

  getCreatedId(dashboard) {
    return dashboard.id;
  },

  async deleteRemote(client, id) {
    await client.deleteDashboard(id);
  },
};

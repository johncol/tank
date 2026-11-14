import { isPathTracked } from "../../../shared/manifest.js";
import {
  stripReadOnlyDashboardFields,
  formatDashboardJson,
} from "./dashboard.js";
import { buildTitledPath } from "../../../shared/slug.js";

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
  actions: ["fetch", "pull", "push"],
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
      content: formatDashboardJson(stripReadOnlyDashboardFields(dashboard)),
    };
  },

  buildFetchPath({ document, id, remote, fileName }) {
    const buildPath = (name) => `${DASHBOARDS_PATH}/${name}.json`;

    if (fileName !== undefined) {
      return buildPath(fileName);
    }

    return buildTitledPath({
      title: remote.title,
      id,
      buildPath,
      isPathTaken: (artifactPath) => isPathTracked(document, artifactPath),
    });
  },

  async updateRemote(client, entry, content) {
    return client.updateDashboard(entry.id, JSON.parse(content));
  },
};

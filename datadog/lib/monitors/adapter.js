import { formatJson, omitFields } from "../../../shared/json.js";
import { isPathTracked } from "../../../shared/manifest.js";
import { buildTitledPath } from "../../../shared/slug.js";
import {
  READ_ONLY_MONITOR_FIELDS,
  findReadOnlyMonitorFields,
} from "./monitor.js";

const MONITORS_PATH = "synced/monitors";

function buildMonitorPath(fileName) {
  return `${MONITORS_PATH}/${fileName}.json`;
}

/**
 * Plugs Datadog monitors into the shared action engine (shared/actions.js).
 * Files are named from the monitor name, unless a file name is given on
 * fetch.
 *
 * Like dashboards, the monitor API has no server-side optimistic
 * concurrency, so the engine's `modified` check is purely client-side.
 *
 * Datadog assigns a new monitor's ID, so --create takes a file name.
 *
 * @type {import("../../../shared/actions.js").AdapterDefinition}
 */
export const monitorAdapter = {
  kind: "monitor",
  label: "Datadog monitor",
  systemName: "Datadog",
  actions: ["fetch", "pull", "push", "create", "delete"],
  allowsFileName: true,
  fileNameSuffix: ".json",
  assignsIdOnCreate: true,
  usageNote: "Its ID is the monitor ID.",

  async getRemote(client, id) {
    return client.getMonitor(id);
  },

  describeRemote(monitor) {
    return {
      title: monitor.name,
      remoteVersion: monitor.modified,
      content: formatJson(omitFields(monitor, READ_ONLY_MONITOR_FIELDS)),
    };
  },

  buildFetchPath({ document, id, remote, fileName }) {
    if (fileName !== undefined) {
      return buildMonitorPath(fileName);
    }

    return buildTitledPath({
      title: remote.name,
      id,
      buildPath: buildMonitorPath,
      isPathTaken: (artifactPath) => isPathTracked(document, artifactPath),
    });
  },

  async updateRemote(client, entry, content) {
    return client.updateMonitor(entry.id, JSON.parse(content));
  },

  buildCreatePath({ fileName }) {
    return buildMonitorPath(fileName);
  },

  // Datadog doesn't enforce unique monitor names, so a same-named monitor is
  // the only way to catch a create that already ran (e.g. retried after a
  // timeout). Its name filter matches part of the name, ignoring case, so
  // only an exact match counts.
  async findRemoteIdByContent(client, content) {
    const { name } = JSON.parse(content);
    const sameNamedMonitor = (await client.listMonitorsByName(name)).find(
      (monitor) => monitor.name === name
    );

    return sameNamedMonitor ? String(sameNamedMonitor.id) : null;
  },

  async createRemote(client, id, content) {
    const monitor = JSON.parse(content);
    const readOnlyFields = findReadOnlyMonitorFields(monitor);

    if (readOnlyFields.length > 0) {
      throw new Error(
        `Remove ${readOnlyFields.join(", ")} from the file: Datadog sets them.`
      );
    }

    const createdMonitor = await client.createMonitor(monitor);

    // The create response has other fields than a read (e.g. no creator), so
    // read it back for the file to match what the next pull gets.
    return client.getMonitor(createdMonitor.id);
  },

  // Datadog's monitor IDs are numbers, but --id gives them to fetch as text,
  // so created entries keep them as text too.
  getCreatedId(monitor) {
    return String(monitor.id);
  },

  async deleteRemote(client, id) {
    await client.deleteMonitor(id);
  },
};

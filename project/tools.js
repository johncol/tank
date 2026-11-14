import { runConfluenceCli } from "../confluence/cli.js";
import { KINDS as CONFLUENCE_KINDS } from "../confluence/lib/kinds.js";
import { MANIFEST_HEADER as CONFLUENCE_MANIFEST_HEADER } from "../confluence/lib/manifest.js";
import { DOMAIN_VARIABLES as CONFLUENCE_DOMAIN_VARIABLES } from "../confluence/lib/config.js";
import { runDatadogCli } from "../datadog/cli.js";
import { KINDS as DATADOG_KINDS } from "../datadog/lib/kinds.js";
import { MANIFEST_HEADER as DATADOG_MANIFEST_HEADER } from "../datadog/lib/manifest.js";
import { DOMAIN_VARIABLES as DATADOG_DOMAIN_VARIABLES } from "../datadog/lib/config.js";

/**
 * A domain setting a tool reads from the project's tank.env.
 * @typedef {Object} DomainVariable
 * @property {string} name
 * @property {string} description What it holds, written above it in tank.env.
 *
 * A sync tool, run as "tank <name>", with its own folder at the project
 * root holding its manifest and artifacts.
 * @typedef {Object} Tool
 * @property {string} name The command name and the folder name.
 * @property {string} serviceName The remote service it syncs with, as
 *   written in prose (e.g. in the project's AGENTS.md and README.md).
 * @property {string} description What the command does, in tank's usage
 *   text.
 * @property {string[]} examples Arguments of example commands, each run as
 *   "tank <name> <example>", listed in the project's AGENTS.md.
 * @property {Record<string, { flag: string, adapter: any }>} kinds The
 *   tool's kinds registry, from its lib/kinds.js.
 * @property {string} manifestHeader The comment block tank owns at the top
 *   of the tool's manifest.
 * @property {DomainVariable[]} domainVariables
 * @property {(argv: string[]) => Promise<unknown>} run Runs the tool's
 *   command with the arguments after its name.
 */

/**
 * Every tool tank runs. Registering a tool here gives it a command and a
 * line in tank's usage text, a folder and manifest on "tank init" and
 * "tank upgrade", a mention and examples in the project's managed AGENTS.md
 * and README.md blocks, its domain settings in tank.env, and its kinds in
 * the action contract's coverage check.
 * @type {Tool[]}
 */
export const TOOLS = [
  {
    name: "confluence",
    serviceName: "Confluence",
    description: "Syncs Confluence pages.",
    examples: ["--pull", "--push --name=<file>.md"],
    kinds: CONFLUENCE_KINDS,
    manifestHeader: CONFLUENCE_MANIFEST_HEADER,
    domainVariables: CONFLUENCE_DOMAIN_VARIABLES,
    run: runConfluenceCli,
  },
  {
    name: "datadog",
    serviceName: "Datadog",
    description:
      "Syncs Datadog dashboards, log-based metrics, and synthetic tests and suites.",
    examples: ["--dashboards --pull", "--log-metrics --fetch --id=<metricId>"],
    kinds: DATADOG_KINDS,
    manifestHeader: DATADOG_MANIFEST_HEADER,
    domainVariables: DATADOG_DOMAIN_VARIABLES,
    run: runDatadogCli,
  },
];

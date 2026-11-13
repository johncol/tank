import { runConfluenceCli } from "../confluence/cli.js";
import { MANIFEST_HEADER as CONFLUENCE_MANIFEST_HEADER } from "../confluence/lib/manifest.js";
import { DOMAIN_VARIABLES as CONFLUENCE_DOMAIN_VARIABLES } from "../confluence/lib/config.js";
import { runDatadogCli } from "../datadog/cli.js";
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
 * @property {string} manifestHeader The comment block tank owns at the top
 *   of the tool's manifest.
 * @property {DomainVariable[]} domainVariables
 * @property {(argv: string[]) => Promise<unknown>} run Runs the tool's
 *   command with the arguments after its name.
 */

/**
 * Every tool tank runs. Registering a tool here gives it a command, a
 * folder and manifest on "tank init" and "tank upgrade", and its domain
 * settings in tank.env.
 * @type {Tool[]}
 */
export const TOOLS = [
  {
    name: "confluence",
    manifestHeader: CONFLUENCE_MANIFEST_HEADER,
    domainVariables: CONFLUENCE_DOMAIN_VARIABLES,
    run: runConfluenceCli,
  },
  {
    name: "datadog",
    manifestHeader: DATADOG_MANIFEST_HEADER,
    domainVariables: DATADOG_DOMAIN_VARIABLES,
    run: runDatadogCli,
  },
];

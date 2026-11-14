import { confluenceTool } from "../confluence/tool.js";
import { datadogTool } from "../datadog/tool.js";

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
 * @property {Record<string, import("../shared/cli.js").KindDefinition>}
 *   kinds The tool's kinds, keyed by manifest `kind`: each one's CLI kind
 *   flag and adapter.
 * @property {string} manifestHeader The comment block tank owns at the top
 *   of the tool's manifest.
 * @property {DomainVariable[]} domainVariables
 * @property {() => any} createClient Creates the API client, reading the
 *   credentials. Called only once the flags are valid.
 *
 * Its manifest is `<name>/sync-manifest.yaml` at the project root, and its
 * manifest paths are relative to `<name>/` (see `runToolCli` in
 * shared/cli.js).
 */

/**
 * Every tool tank runs. Registering a tool here gives it a command and a
 * line in tank's usage text, a folder and manifest on "tank init" and
 * "tank upgrade", a mention and examples in the project's managed AGENTS.md
 * and README.md blocks, its domain settings in tank.env, and its kinds in
 * the action contract's coverage check.
 * @type {Tool[]}
 */
export const TOOLS = [confluenceTool, datadogTool];

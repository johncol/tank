import {
  ACTIONS,
  ACTIONS_ALLOWING_ALL_ENTRIES,
  ACTIONS_NEEDING_ID,
  formatFlags,
  listParentFlags,
} from "./cli-arguments.js";
import { wrapText } from "./wrap-text.js";

/**
 * @typedef {import("./actions.js").AdapterDefinition} AdapterDefinition
 * @typedef {import("./cli-arguments.js").KindDefinition} KindDefinition
 */

/** The usage text's line width, and the column flag descriptions start at. */
const USAGE_WIDTH = 80;
const USAGE_DESCRIPTION_COLUMN = 24;

/**
 * Builds a tool's usage text from its kinds' adapter capabilities, so it
 * can't drift from what the flags accept (CONVENTIONS.md "Flags").
 *
 * @param {Object} usage
 * @param {string} usage.command How the tool is run (e.g. "tank datadog").
 * @param {Object<string, KindDefinition>} usage.kinds The tool's kinds,
 *   keyed by manifest `kind`.
 * @returns {string}
 */
export function buildUsage({ command, kinds }) {
  const kindDefinitions = Object.values(kinds);
  const adapters = kindDefinitions.map(({ adapter }) => adapter);
  const isSingleKind = kindDefinitions.length === 1;
  const supportedActions = ACTIONS.filter((action) =>
    adapters.some((adapter) => adapter.actions.includes(action))
  );
  const flagsOfKinds = (predicate) =>
    formatFlags(
      kindDefinitions
        .filter(({ adapter }) => predicate(adapter))
        .map(({ flag }) => flag)
    );
  const fetchFileNameFlags = flagsOfKinds(
    (adapter) => adapter.allowsFileName && adapter.actions.includes("fetch")
  );
  const createFileNameFlags = flagsOfKinds(
    (adapter) =>
      Boolean(adapter.assignsIdOnCreate) && adapter.actions.includes("create")
  );
  const createIdFlags = flagsOfKinds(
    (adapter) =>
      !adapter.assignsIdOnCreate && adapter.actions.includes("create")
  );
  const parentFlags = listParentFlags(kindDefinitions);
  const takesFileName = fetchFileNameFlags !== "" || createFileNameFlags !== "";

  const synopsis = [
    `Usage: ${command}`,
    isSingleKind ? `[--${kindDefinitions[0].flag}]` : "<kind>",
    "<action> [--id=<id> | --name=<name>]",
    ...(takesFileName ? ["[--file-name=<kebab-case-name>]"] : []),
    ...parentFlags.map((parentFlag) => `[--${parentFlag}=<name>]`),
    "[--force]",
  ].join(" ");

  const kindHeading = isSingleKind
    ? "Kind (optional, since it's the only one):"
    : "Kind (exactly one):";
  const kindLines = kindDefinitions.map(({ flag, adapter }) =>
    formatUsageOption(`--${flag}`, describeKind(adapter, kinds))
  );

  const idRequirements = ["Required with --fetch"];

  if (createIdFlags !== "") {
    idRequirements.push(`with ${createIdFlags} --create`);
  }

  const nameActions = supportedActions.filter(
    (action) => !ACTIONS_NEEDING_ID.includes(action)
  );
  const fileNameUses = [];

  if (fetchFileNameFlags !== "") {
    fileNameUses.push(
      `on --fetch, with ${fetchFileNameFlags} (instead of the title)`
    );
  }

  if (createFileNameFlags !== "") {
    fileNameUses.push(`on --create, required with ${createFileNameFlags}`);
  }

  const flagLines = [
    formatUsageOption("--id=<id>", [
      `The remote ID. ${idRequirements.join(", and ")}.`,
    ]),
    formatUsageOption("--name=<name>", [
      `Selects a tracked artifact by its file name, with or without its extension. Only with ${formatFlags(nameActions)}.`,
    ]),
    ...(takesFileName
      ? [
          formatUsageOption("--file-name=<name>", [
            `Names the new file, with or without its extension: ${fileNameUses.join("; ")}.`,
          ]),
        ]
      : []),
    ...parentFlags.map((parentFlag) =>
      formatUsageOption(
        `--${parentFlag}=<name>`,
        describeParentFlag(parentFlag, kindDefinitions, kinds)
      )
    ),
    formatUsageOption("--force", [
      supportedActions.includes("create")
        ? "Overrides the forceable checks. Not accepted with --create."
        : "Overrides the forceable checks.",
    ]),
  ];

  const footerLines = [];
  const allEntriesActions = supportedActions.filter((action) =>
    ACTIONS_ALLOWING_ALL_ENTRIES.includes(action)
  );

  if (allEntriesActions.length > 0) {
    footerLines.push(
      `${allEntriesActions.map((action) => `--${action}`).join(" and ")} without --id or --name ${allEntriesActions.length > 1 ? "run" : "runs"} on every tracked artifact of the kind.`
    );
  }

  if (supportedActions.includes("delete")) {
    footerLines.push("--delete always needs --id or --name.");
  }

  return [
    synopsis,
    [kindHeading, ...kindLines].join("\n"),
    `Action (exactly one): ${formatFlags(supportedActions)}`,
    flagLines.join("\n"),
    ...(footerLines.length > 0 ? [footerLines.join("\n")] : []),
  ].join("\n\n");
}

/**
 * Describes a kind under its kind flag in the usage text: its actions and
 * how its capabilities change the flags.
 * @param {AdapterDefinition} adapter
 * @param {Object<string, KindDefinition>} kinds
 * @returns {string[]} One paragraph per line of description.
 */
function describeKind(adapter, kinds) {
  const paragraphs = [`actions: ${formatFlags(adapter.actions)}`];

  if (adapter.allowsFileName && adapter.actions.includes("fetch")) {
    paragraphs.push(
      "--fetch takes --file-name to name the new file instead of the title."
    );
  }

  if (adapter.actions.includes("create")) {
    paragraphs.push(
      adapter.assignsIdOnCreate
        ? `--create requires --file-name, since ${adapter.systemName} assigns the ID.`
        : "--create requires --id, which also names the file."
    );
  }

  if (adapter.parent && adapter.actions.includes("create")) {
    const parentFlag = kinds[adapter.parent.kind]?.flag;

    paragraphs.push(
      `--create can take --${adapter.parent.flag} to create it inside a tracked --${parentFlag} artifact.`
    );
  }

  if (adapter.usageNote) {
    paragraphs.push(adapter.usageNote);
  }

  return paragraphs;
}

/**
 * Describes a parent flag (e.g. "suite") in the usage text.
 * @param {string} parentFlag
 * @param {KindDefinition[]} kindDefinitions
 * @param {Object<string, KindDefinition>} kinds
 * @returns {string[]}
 */
function describeParentFlag(parentFlag, kindDefinitions, kinds) {
  const childDefinitions = kindDefinitions.filter(
    ({ adapter }) => adapter.parent?.flag === parentFlag
  );
  const childFlags = formatFlags(childDefinitions.map(({ flag }) => flag));
  const parentKindFlags = formatFlags([
    ...new Set(
      childDefinitions.map(
        ({ adapter }) => kinds[/** @type {any} */ (adapter.parent).kind]?.flag
      )
    ),
  ]);

  return [
    `With ${childFlags} --create: creates the artifact in the folder of the tracked ${parentKindFlags} artifact this names (matched like its --name), and adds it to that parent.`,
  ];
}

/**
 * Formats a flag and its description in the usage text, wrapping each
 * paragraph of the description under the description column.
 * @param {string} label
 * @param {string[]} paragraphs
 * @returns {string}
 */
function formatUsageOption(label, paragraphs) {
  const indent = " ".repeat(USAGE_DESCRIPTION_COLUMN);
  const labelText = `  ${label}`;
  const wrapOptions = { indent, width: USAGE_WIDTH };

  if (labelText.length < USAGE_DESCRIPTION_COLUMN) {
    return wrapText(paragraphs, {
      ...wrapOptions,
      firstLine: labelText.padEnd(USAGE_DESCRIPTION_COLUMN),
    });
  }

  return `${labelText}\n${wrapText(paragraphs, { ...wrapOptions, firstLine: indent })}`;
}

# Sync tool conventions

Every action behaves the same way for every kind of artifact, in both tools. If you learn how `--push` works for a Datadog dashboard, you know how it works for a Confluence page. Kinds may differ only where this document allows it, and those differences must be declared in the kind's adapter, never hard-coded in a CLI or an action.

New actions, flags, or kinds must follow this contract and update it first if it needs to change. The contract tests in `shared/__tests__/action-contract.test.js` run every kind through the same cases.

## Terms

- **Project**: a folder with a `tank.env` (its domain settings) and one folder per tool, each holding the tool's `sync-manifest.yaml` and synced files.
- **Project root**: the folder tank runs from. Always the current folder: tank never searches parent folders.
- **Tool**: `confluence` or `datadog`, each registered in `project/tools.js`.
- **Kind**: what an artifact is: `page` (Confluence), `dashboard`, `log-metric`, `synthetic-test`, `synthetic-suite` (Datadog).
- **Artifact**: one remote object (a page, a dashboard, ...) and its local file.
- **Entry**: an artifact's record in its tool's `sync-manifest.yaml`. An artifact is **tracked** once it has an entry.

## Manifest entries

Every entry has the same fields, keyed by the local file's path (relative to the tool's folder):

| Field           | Holds                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`          | The artifact's kind.                                                                                                                                                 |
| `id`            | The remote ID (Confluence page ID, Datadog public ID or metric name).                                                                                                |
| `title`         | The remote title or name, for humans. Refreshed on every sync. Never pushed.                                                                                         |
| `remoteVersion` | What the remote-change check compares: Confluence's version number, Datadog's `modified_at`, or (for log metrics, which have neither) a hash of the live definition. |
| `contentHash`   | Hash of the local file at the last sync.                                                                                                                             |
| `lastSyncedAt`  | When a sync last changed the file or the remote. A no-op never bumps it.                                                                                             |

Only tank writes the manifest. Editing an entry by hand changes nothing remotely. Tank also owns the manifest's header comments: `tank upgrade` rewrites them, never the entries.

## Flags

`tank confluence` and `tank datadog` are thin: each tool's `<tool>/tool.js` declares its kinds and client, and `runCli` in `shared/cli.js` parses, validates, dispatches, and prints the summary the same way for every tool, on the tool's folder and its manifest. Validation comes from the selected kind's adapter (`actions`, `allowsFileName`, `findEntriesByName`), never from a branch on the kind. The usage text comes from the same capabilities: `runCli` builds each kind's lines from its kind flag and adapter, so the tools never restate them. Before anything else, `runCli` checks that each adapter declares the capabilities its others depend on (e.g. `create` needs `buildCreatePath` and `createRemote`; see `shared/adapter-capabilities.js`), and throws if one is missing. What the capabilities can't say (e.g. what the ID is, or how `findEntriesByName` matches) goes in the adapter's optional `usageNote`. Every flag is validated before the manifest, the credentials, or the network are touched.

- `--help` (or `-h`) prints the command's usage text to stderr and a successful empty summary to stdout, and exits 0, whatever else is passed. It works for `tank` itself and every command, outside a project root too, and never touches the manifest, the credentials, or the network.
- Tool commands run only at a project root. That's checked before anything else, flags included (except `--help`): a folder without a `tank.env`, or a `tank.env` that sets anything but the tools' domain settings, fails the run, with the reason on stderr.
- A tool whose manifest is missing (e.g. in a project initialized before the tool was added to tank) fails the run, asking to run `tank upgrade`, before the credentials or the network are touched.
- Exactly one action flag per run (`--fetch`, `--pull`, `--push`, `--create`, `--delete`). An action the kind's adapter doesn't support is rejected.
- A tool with several kinds (Datadog) takes exactly one kind flag (`--dashboards`, `--log-metrics`, `--synthetic-tests`, `--synthetic-suites`), so an omitted flag never defaults to a kind. A tool with a single kind (Confluence) doesn't need one: `--pages` is accepted but optional.
- `--id=<remoteId>` picks an artifact by its remote ID. Required by `--fetch`, and by `--create` for kinds whose ID you choose (`log-metric`). Rejected by `--create` for kinds whose ID the remote assigns (`synthetic-test`, `page`: their adapters set `assignsIdOnCreate`).
- `--name=<name>` picks a **tracked** artifact, with `--pull`, `--push`, and `--delete` only. It never names a new file. By default it's the file name, with or without its extension (a log metric's file name is its metric ID). A kind may match differently through its adapter's `findEntriesByName`: a synthetic suite matches its folder name, with or without a trailing `/`. A name matching more than one entry (e.g. synthetic tests in different suite folders) fails and lists their paths; one matching none fails too.
- `--file-name=<kebab-case-name>` names the new file, with or without its extension:
  - with `--fetch`, for kinds whose adapter sets `allowsFileName` (`page`, `dashboard`);
  - with `--create`, for kinds whose adapter sets `assignsIdOnCreate`, where it's required, since there's no ID to derive the file name from.

  Other kinds and actions reject it.

- A parent flag (e.g. `--suite=<suite-folder>`) creates the artifact inside a tracked parent artifact, with `--create` only, for kinds whose adapter declares a `parent`. It matches the parent the same way the parent kind's `--name` does. Leave it out to create the artifact without a parent.
- `--force` overrides the checks marked _forceable_ below, for the named artifact only. It never carries over to other artifacts an action touches (e.g. tests fetched by a suite pull). `--create` rejects it.
- Pass `--id` or `--name`, not both. `--pull` and `--push` without either run on every tracked artifact of the kind. `--delete` needs one, so it never deletes in bulk.
- Unknown flags and positional arguments are rejected.

## Actions

Checks run in the order listed. The first failing check stops the action, before anything is written.

### `--fetch`: start tracking an existing remote artifact

A path named from the title (`--file-name` left out) uses the title's slug, e.g. `homepage-us.json`. If the slug is empty, the path uses the remote ID instead (`abc-123.json`). If another entry already tracks the slug's path, the path adds the ID (`homepage-us-abc-123.json`). A tracked artifact keeps its path, so this only names new files. An explicit `--file-name` is never changed: it fails at step 2.

1. Fails if the ID is already tracked. Use `--pull`.
2. Fails if the target path is tracked by another entry.
3. Fails if the target path exists but isn't tracked. _Forceable._
4. Writes the file and adds the entry.

### `--pull`: remote to local

1. Fails if the remote artifact no longer exists.
2. Fails if the local file has unpushed changes (`contentHash` mismatch). _Forceable._ A missing local file isn't a change: pull restores it.
3. Kind-specific checks (e.g. a synthetic test moving folders onto an existing file).
4. `skipped` if the remote content and `remoteVersion` both match what's tracked, and the file is intact. Nothing is written, but follow-ups still run.
5. If only `remoteVersion` or `title` changed, updates the entry without touching the file or `lastSyncedAt`.
6. Otherwise writes the file (removing the old one, and its folder if left empty, when it moved) and updates the entry.

### `--push`: local to remote

1. Fails if the local file is missing. Pull to restore it.
2. Fails if the remote artifact no longer exists.
3. Fails if the remote changed since the last sync (`remoteVersion` mismatch). _Forceable._
4. `skipped` if the local file matches `contentHash`. _Forceable_ (pushes anyway).
5. Kind-specific checks. Each is either forceable (e.g. Confluence's markdown round-trip check) or never forceable (e.g. a log metric's `compute`, which Datadog rejects anyway).
6. Writes the remote and updates the entry.

### `--create`: start tracking a new artifact written locally

The local file's path comes from `--id` (kinds whose ID you choose) or from `--file-name` and the parent's folder (kinds whose ID the remote assigns).

1. Fails if the ID is already tracked, or the path is tracked by another entry. Use `--push`.
2. Fails if the local file is missing.
3. With a parent: fails if the parent's local file has unpushed changes, or the parent remote is missing or changed since the last sync. Pull or push it first.
4. Fails if the remote artifact already exists. Use `--fetch`. For kinds whose ID the remote assigns, "already exists" means a remote artifact with the same title, read from the local file (a synthetic test's `name`, a page's leading `# ` heading), since there's no ID to look up.
5. Creates the remote, rewrites the file with what the remote returned, and adds the entry.
6. With a parent: adds the new artifact to the parent remote, then rewrites the parent's file and entry from what the remote returned, as a pull would. Returns a second result for the parent. If this step fails, the new artifact stays created and tracked, and the parent's result fails with how to finish by hand.

`--force` isn't accepted.

### `--delete`: delete the remote artifact and stop tracking it

1. Fails if the local file has unpushed changes. _Forceable._
2. Fails if the remote artifact no longer exists. _Forceable_: only untracks.
3. Fails if the remote changed since the last sync. _Forceable._
4. For kinds with a parent: fails if the remote artifact belongs to a parent that isn't tracked (fetch it first; it's never fetched for you), or to a tracked parent with unpushed changes or remote changes since the last sync. Not forceable.
5. For kinds with a parent: removes the artifact from each parent remote, then rewrites the parent's file and entry, as a pull would. Returns one `delete` result per parent. If this fails, nothing is deleted; run `--delete` again.
6. Deletes the remote, the local file (and its folder, if left empty), and the entry.

A missing local file doesn't stop a delete.

## Results

Every run prints exactly one JSON summary to stdout, and exits 0 when every result succeeded or was skipped, or 1 otherwise:

```json
{
  "ok": true,
  "total": 2,
  "succeeded": 1,
  "skipped": 1,
  "failed": 0,
  "results": []
}
```

`ok` is false when any result failed, or when the run stopped with an `error`. That includes invalid flags (the reason and the usage text go to stderr) and unexpected errors (e.g. missing credentials): stdout still gets the summary, with `"ok": false`, the `error` message, and the results gathered so far (none, for invalid flags). A tracked artifact `--id` or `--name` doesn't find is a failed result, not an `error`.

Every result has the same fields:

| Field           | Holds                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `kind`          | The artifact's kind.                                                                                |
| `id`            | The remote ID, when known.                                                                          |
| `path`          | The local path, when known.                                                                         |
| `action`        | `fetch`, `pull`, `push`, `create`, or `delete` (`init`, `upgrade`, or `docs` for project commands). |
| `status`        | `success`, `skipped` (nothing needed to change), or `failed`.                                       |
| `remoteVersion` | The `remoteVersion` now tracked, when known.                                                        |
| `message`       | Why it failed, or a follow-up step the user should take (e.g. pull a suite's tests).                |
| `movedFrom`     | The previous path, only when a pull moved the file.                                                 |

An action returns its own artifact's result first, followed by one result for every other artifact it fetched or updated along the way.

## What kinds may do differently

Declared in the kind's adapter, and covered by the contract tests:

- Which actions they support.
- Whether `--create` takes the ID (`--id`) or the remote assigns it (`--file-name`), and which parent kind, if any, the artifact belongs to (`--create` can add it to one, `--delete` removes it from all of them).
- How the remote ID, title, and `remoteVersion` are read, and how the file is serialized.
- How the target path is computed (from the title, the ID, or suite membership).
- Kind-specific checks, each marked forceable or not.
- Follow-up artifacts (a suite fetching its untracked tests) and follow-up messages (a suite delete asking to pull its tests). Follow-up artifacts are of another of the tool's kinds (`followUpKind`), whose adapter `runCli` passes in, as it does the parent's.

## Project commands: `init`, `upgrade`, and `docs`

They don't act on artifacts, so they take no action or kind flags (only `--help`). They print the same JSON summary, with one result per file they check (`skipped` when it needed no change), one per migration that ran, and, for `init`, one per git step (without a `path`). Each holds `path`, `action` (`init` or `upgrade`), `status`, and, when useful, `message`.

`tank init`:

1. Fails if `tank.env` or any tool's manifest already exists. Use `tank upgrade`.
2. Runs `git init`, unless the folder is already inside a git repo.
3. Adds `.env` and `.DS_Store` to `.gitignore` if missing.
4. Runs the `upgrade` steps.
5. Writes `tank.env` (a commented placeholder per domain setting).
6. Commits only the files it created or changed.

`tank upgrade` runs only at a project root. It adds or refreshes, never deletes:

1. Runs pending migrations.
2. Creates missing tool folders and manifests.
3. Rewrites what tank owns: manifest header comments, and the block between `<!-- tank:start -->` and `<!-- tank:end -->` in the project's `AGENTS.md` and `README.md`.
4. Appends commented placeholders for new domain settings to `tank.env`.

Only `init` touches git. Sync commands and `upgrade` never do.

`tank docs` runs anywhere and never reads credentials. It prints the absolute paths of this working copy's `README.md` and `CONVENTIONS.md` to stderr, one per line, and the same JSON summary to stdout, with one `success` result per doc holding its `path`. The managed blocks point at `tank docs` rather than at tank's folder, so they read the same for everyone.

Every project runs the working copy of tank, so changes must stay backward compatible with existing projects' files. A change that must break them ships, in the same change, an idempotent migration in `project/migrations.js` with a test. Each migration detects for itself whether it applies: no version is stored in the project. Sync commands that meet the old format fail and ask to run `tank upgrade`.

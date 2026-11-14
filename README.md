# tank

`tank` keeps local files in sync with Confluence pages and Datadog artifacts. Every artifact supports the same five actions with the same flags, so once you know how `--push` works for a dashboard, you know how it works for a page.

It's named after the Matrix operator who loads programs in and pulls the crew out: push and pull.

## Setup

1. Install the dependencies (Node 20.19+, 22.13+, or 24+; `nvm use` picks the version in `.nvmrc`):

   ```bash
   cd ~/ReposJohn/tank && npm install
   ```

2. Link the command once (`~/.local/bin` must be on your `PATH`). It runs this working copy directly, so edits take effect right away:

   ```bash
   ln -s ~/ReposJohn/tank/bin/tank.js ~/.local/bin/tank
   ```

3. Add your credentials to `~/.config/tank/.env`. Every project shares this file, and it's never committed:

   ```bash
   mkdir -p ~/.config/tank && cp .env.example ~/.config/tank/.env
   ```

   | Tool       | Variables                                                                                                                                                                                                           |
   | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Confluence | `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN` ([create a token](https://id.atlassian.com/manage-profile/security/api-tokens))                                                                   |
   | Datadog    | `DATADOG_SITE` (e.g. `datadoghq.com`), `DATADOG_API_KEY`, `DATADOG_APP_KEY` scoped to `dashboards_*`, `logs_read_config`, `logs_generate_metrics`, `monitors_*`, `synthetics_*` (`_read` and `_write` for each `*`) |

   Variables already set in your environment win over this file.

## Projects

A project is a folder, usually its own git repo, that holds the synced files. tank always runs on the current folder and never searches parent folders.

```
tank.env               # domain settings (committed)
confluence/
  sync-manifest.yaml   # which file maps to which page
  synced/              # markdown files
datadog/
  sync-manifest.yaml   # which file maps to which artifact
  synced/              # JSON files, one folder per kind
```

`tank.env` holds only domain settings: `CONFLUENCE_SPACE_ID` and `CONFLUENCE_PARENT_ID`, which say where `tank confluence --create` puts new pages. tank refuses to run if `tank.env` sets anything else, such as a credential.

| Command        | What it does                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tank init`    | Makes the current folder a project: runs `git init` if needed, ignores `.env`, runs `tank upgrade`, writes `tank.env`, and commits only what it created.                                               |
| `tank upgrade` | Brings the project up to date with this copy of tank: runs migrations, adds missing folders and manifests, and refreshes the parts tank owns. It never deletes or commits, so you can review the diff. |
| `tank status`  | Lists files that are `modified`, `missing`, or `untracked` compared with the manifests. It works offline, so it can't see remote changes; `--pull` does that.                                          |
| `tank docs`    | Prints where this copy of tank keeps `README.md` and `CONVENTIONS.md`.                                                                                                                                 |

tank owns the manifest header comments and the block between `<!-- tank:start -->` and `<!-- tank:end -->` in the project's `AGENTS.md` and `README.md`. Everything else in those files is yours.

## Syncing

```
tank confluence          <action> [--id=… | --name=…] [options]
tank datadog     <kind>  <action> [--id=… | --name=…] [options]
```

Datadog needs a kind flag on every run, so tank never guesses one. Confluence only has pages, so `--pages` is optional.

### Actions

| Action     | What it does                                                        | Selects the artifact with                                      |
| ---------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `--fetch`  | Starts tracking an existing remote artifact and writes its file.    | `--id`                                                         |
| `--pull`   | Updates tracked files from the remote.                              | `--id`, `--name`, or neither for every tracked one of the kind |
| `--push`   | Updates the remote from tracked files.                              | `--id`, `--name`, or neither for every tracked one of the kind |
| `--create` | Creates the remote from a new file you wrote, then starts tracking. | `--id` or `--file-name`, depending on the kind (see below)     |
| `--delete` | Deletes the remote, the file, and the manifest entry.               | `--id` or `--name` (never in bulk)                             |

### Flags

- `--id=<remoteId>`: the artifact's ID in Confluence or Datadog.
- `--name=<name>`: a **tracked** artifact's file name, with or without its extension.
- `--file-name=<kebab-case>`: names the new file on `--fetch` (optional, when the kind allows it) or `--create` (required when the remote assigns the ID).
- `--force`: overrides the safety checks below for the selected artifact only.
- `--help`: prints usage. Works anywhere, offline.

### Safety checks

tank records a hash of each file (`contentHash`) and the remote's version (`remoteVersion`) at every sync. Each action refuses to run when it would lose someone's work:

| Action     | Refuses when                                                                                                  | `--force`                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `--fetch`  | The ID is already tracked (use `--pull`), or the target file already exists.                                  | Overrides the existing file only                        |
| `--pull`   | The file has local edits you haven't pushed.                                                                  | Overwrites them                                         |
| `--push`   | The remote changed since the last sync.                                                                       | Overwrites it, and pushes unchanged files too           |
| `--create` | The file is missing or already tracked, or a remote with the same ID or title already exists (use `--fetch`). | Not accepted                                            |
| `--delete` | The file has unpushed edits, the remote changed, or the remote is already gone.                               | Overrides all three; a missing remote is only untracked |

`--pull` and `--push` also fail when the remote is gone, and `--push` fails when the file is missing (pull restores it). Artifacts that changed on neither side are reported as `skipped`. In bulk runs, each artifact succeeds or fails on its own, and the manifest is saved after each one.

### Output

Every run prints one JSON summary to stdout and exits `1` if anything failed. Each result holds `kind`, `id`, `path`, `action`, and `status` (`success`, `skipped`, or `failed`), plus `remoteVersion`, `message`, and `movedFrom` when they apply. Usage and errors go to stderr.

### Examples

```bash
tank confluence --fetch --id=123456 --file-name=runbook
tank confluence --push --name=runbook
tank datadog --monitors --pull
tank datadog --dashboards --create --file-name=checkout-latency
tank datadog --log-metrics --delete --id=mrt.example
```

## Kinds

| Kind             | Flag                 | `--id` is                        | Files live in                                   | `--create` takes          | `--fetch --file-name` |
| ---------------- | -------------------- | -------------------------------- | ----------------------------------------------- | ------------------------- | --------------------- |
| Page             | `--pages` (optional) | page ID                          | `confluence/synced/`                            | `--file-name`             | ✓                     |
| Dashboard        | `--dashboards`       | dashboard ID                     | `datadog/synced/dashboards/`                    | `--file-name`             | ✓                     |
| Monitor          | `--monitors`         | monitor ID                       | `datadog/synced/monitors/`                      | `--file-name`             | ✓                     |
| Log-based metric | `--log-metrics`      | metric name (also the file name) | `datadog/synced/log-metrics/`                   | `--id`                    |                       |
| Synthetic test   | `--synthetic-tests`  | public ID                        | `datadog/synced/synthetics/<suite>/`            | `--file-name` [`--suite`] |                       |
| Synthetic suite  | `--synthetic-suites` | public ID                        | `datadog/synced/synthetics/<suite>/_suite.json` | not supported             |                       |

Files are named from the artifact's title unless the table says otherwise. When two titles clash, tank adds the ID to the file name.

To write a file for `--create`, copy a fetched file of the same kind and edit it. Fetched files already leave out the read-only fields the remote assigns. For dashboards and monitors, `--create` rejects files that include them.

### Page

- The file is markdown. For `--create`, its first line is the page title as a `# ` heading. tank moves the title to the manifest and rewrites the file without it.
- New pages go in `CONFLUENCE_SPACE_ID`, under `CONFLUENCE_PARENT_ID`.
- `--push` and `--create` refuse markdown that changes when converted to Confluence's format and back. `--force` pushes it anyway.
- `--push` never renames a page.
- `--delete` moves the page to the Confluence trash. Its child pages aren't deleted.

### Dashboard and monitor

- The file is Datadog's definition, without read-only fields. A monitor's file also leaves out its alert state, so a monitor that changes state never shows as edited.
- A new monitor starts evaluating and notifying right away.
- Datadog refuses to delete a monitor that an SLO or composite monitor still uses.

### Log-based metric

- The file holds `filter`, `group_by`, and `compute`. Datadog fixes `compute` at creation, so `--push` refuses changes to it, even with `--force`.
- Deleting a metric loses its history, and widgets that plot it go blank.

### Synthetic tests and suites

Tests live in the folder of the suite they belong to, so membership is visible at a glance:

```
datadog/synced/synthetics/
  s-latency-content-pages/
    _suite.json          # the suite and its list of tests
    faq-page-latency.json
  _no-suite/             # tests in no suite
  _multiple-suites/      # tests in more than one suite
```

- Datadog decides membership: `--fetch` and `--pull` place a test by asking which suites contain it, and move its file when that changes.
- A suite's `--name` is its folder name. If a test's `--name` matches files in more than one folder, use `--id`.
- Fetching or pulling a suite also fetches its untracked tests.
- `--create --suite=<folder>` adds the new test to that suite as a critical test.
- To move a test, edit both suites' `tests` lists, push both suites, then pull the test.
- Deleting a test first removes it from its suites. Deleting a suite keeps its tests.
- Only `api` and `browser` tests can be pushed or created.

Datadog rate-limits some endpoints. On a 429, tank waits for the reset time Datadog reports and retries up to 3 times.

## Changing tank

```
bin/tank.js    # the "tank" command
project/       # init, upgrade, status, docs, and the tools registry (tools.js)
shared/        # code shared by both tools: runCli, actions, manifest, config
confluence/    # Confluence tool and its kinds
datadog/       # Datadog tool and its kinds
CONVENTIONS.md # the contract every action, flag, and kind follows
```

Before finishing any change, run:

```bash
npm test && npm run typecheck && npm run lint && npm run format:check
```

- **Keep projects working.** Every project runs this working copy. When a change must break existing project files, ship an idempotent migration in `project/migrations.js` with a test, so `tank upgrade` fixes every project.
- **New tool:** define it in `<name>/tool.js` and register it in `project/tools.js`, the only place tools are listed.
- **New kind, action, or flag:** follow `CONVENTIONS.md`, and update it first if the contract needs to change.
- **Editor:** install the recommended TypeScript 7 extension (`TypeScriptTeam.native-preview`) so editor errors match `npm run typecheck`.

# tank

`tank` keeps local files in sync with Confluence pages and Datadog artifacts (dashboards, log-based metrics, synthetic tests and suites). It works on a **project**: a folder that holds the synced files, their manifests, and the project's settings, usually in its own git repo. It's named after the Matrix operator who loads programs in and pulls the crew out: push and pull.

```
bin/tank.js    # the "tank" command: dispatches init, upgrade, docs, confluence, datadog
project/       # init, upgrade, and docs, the tools registry (tools.js), the project root check
shared/        # code used by both tools (runCli, actions, manifest, config, ...)
confluence/    # Confluence sync tool
datadog/       # Datadog sync tool
CONVENTIONS.md # the contract every action, flag, and kind follows
```

## Setup

1. Install the dependencies (Node 20.19+, 22.13+, or 24+; `nvm use` picks the version in `.nvmrc`):

   ```bash
   cd ~/ReposJohn/tank && npm install
   ```

2. Link the command, once (`~/.local/bin` must be on your `PATH`):

   ```bash
   ln -s ~/ReposJohn/tank/bin/tank.js ~/.local/bin/tank
   ```

   `tank` runs this working copy directly, so edits take effect right away, with no build or publish step. Unlike an alias, it works in non-interactive shells and for agents. Unlike `npm link`, it keeps working when you switch Node versions with nvm.

3. Add your credentials to the user file, `~/.config/tank/.env`:

   ```bash
   mkdir -p ~/.config/tank && cp .env.example ~/.config/tank/.env
   ```

   Fill it in. It's shared by every project and never committed. Variables already set in the environment win over it.

   - Confluence: `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, and `CONFLUENCE_API_TOKEN` (create a token at https://id.atlassian.com/manage-profile/security/api-tokens).
   - Datadog: `DATADOG_API_KEY`, `DATADOG_APP_KEY` (scoped to `dashboards_read`, `dashboards_write`, `logs_read_config`, `logs_generate_metrics`, `synthetics_read`, and `synthetics_write`), and `DATADOG_SITE` (e.g. `datadoghq.com`, or `us5.datadoghq.com`).

   The Confluence URL and Datadog site live here, next to the credentials, because each token only works with its own site.

## Projects

A project is a folder (e.g. `~/Repos/dynamic-rendering`) with a `tank.env` and one folder per tool:

```
tank.env               # the project's domain settings (committed)
confluence/
  sync-manifest.yaml   # which file maps to which page
  synced/              # markdown files synced with Confluence pages
datadog/
  sync-manifest.yaml   # which file maps to which artifact
  synced/              # JSON files synced with Datadog artifacts
```

The project root is always the current folder: tank never searches parent folders. Every command except `tank init` and `tank docs` refuses to run in a folder without a `tank.env` ("Not a tank project", on stderr and in the summary), so running from inside `confluence/` can't nest artifacts there.

### `tank.env`

Holds the project's domain settings, and only those, since it's committed:

- `CONFLUENCE_SPACE_ID`: the space new pages are created in.
- `CONFLUENCE_PARENT_ID`: the page or folder new pages are created under.

Both are read only from `tank.env`, never from the environment or the user file, so one project's settings can't leak into another. Only `tank confluence --create` needs them. If `tank.env` sets anything else (e.g. a credential), every command refuses to run.

### `tank init`

Makes the current folder a project:

```bash
mkdir ~/Repos/my-project && cd ~/Repos/my-project && tank init
```

1. Refuses to run if `tank.env` or any tool's manifest already exists. Use `tank upgrade` instead.
2. Runs `git init`, unless the folder is already inside a git repo.
3. Writes `tank.env`, with a commented placeholder for each domain setting, and `.gitignore`, adding `.env` and `.DS_Store` if they're missing.
4. Runs the same steps as `tank upgrade`.
5. Commits only the files it created or changed ("Initialize tank project"). Anything else you staged is left alone.

### `tank upgrade`

Brings the current project up to date with this working copy of tank. It adds or refreshes files, never deletes them, and never commits, so you can review the diff.

1. Runs pending migrations.
2. Creates missing tool folders and manifests. A new manifest holds only its header comments.
3. Rewrites what tank owns:
   - the manifest header comments (never the entries);
   - the block between `<!-- tank:start -->` and `<!-- tank:end -->` in the project's `AGENTS.md` and `README.md`. Everything outside the block is the project's own and is kept. A missing file is created, and a file without the markers gets the block appended.
4. Appends commented placeholders for new domain settings to `tank.env`.

There's no list of projects, so `tank upgrade` only runs on the current one. Run it in each project when you next work there.

### `tank docs`

Prints where this working copy of tank keeps its docs: the absolute paths of `README.md` and `CONVENTIONS.md`, one per line on stderr. It works anywhere, even outside a project, and never reads credentials. Like every command, it also prints one JSON summary to stdout, with one result per doc holding its `path`.

The `AGENTS.md` and `README.md` blocks tell readers to run `tank docs` instead of naming tank's folder, since each teammate may have tank checked out somewhere else.

`tank init` and `tank upgrade` print one JSON summary, like the sync commands. The sync commands (`tank confluence`, `tank datadog`) never touch git, and `tank upgrade` never commits: only `tank init` does.

## Commands at a glance

Both tools share the same actions and flags, and the same command-line runner. Datadog also needs a kind flag on every call (`--dashboards`, `--log-metrics`, `--synthetic-tests`, or `--synthetic-suites`), so an omitted flag never silently defaults to one kind. Confluence only has pages, so it doesn't need one (`--pages` is accepted but optional).

| Action     | Confluence | Datadog                                   |
| ---------- | ---------- | ----------------------------------------- |
| `--fetch`  | pages      | every kind                                |
| `--pull`   | pages      | every kind                                |
| `--push`   | pages      | every kind                                |
| `--create` | pages      | log-based metrics, synthetic tests        |
| `--delete` | —          | log-based metrics, synthetic tests/suites |

Select one artifact with `--id` (its Confluence or Datadog ID) or, for a tracked artifact, `--name` (its file name). Leave both out of `--pull`/`--push` to run on everything tracked in the manifest. `--delete` always needs one. `--file-name` names a new file on `--fetch` (pages and dashboards only) and on `--create` (pages and synthetic tests only). See `CONVENTIONS.md` for every flag rule.

## How every command behaves

- Each run prints one JSON summary to stdout (`ok`, `succeeded`, `skipped`, and `failed` counts, plus one result per file) and exits non-zero if anything failed. Invalid flags also print a summary, with `"ok": false` and an `error`, and the usage text goes to stderr.
- `--help` (or `-h`) prints the usage text to stderr and a successful empty summary to stdout, and exits 0: `tank --help` for the commands, `tank <command> --help` for one command. It works anywhere, even outside a project, and never reads credentials.
- In bulk mode (no `--id` or `--name`, `--pull`/`--push` only), each artifact succeeds or fails independently: one bad entry doesn't block the rest. The manifest is saved after each artifact, so an interrupted run keeps what it already synced. `--fetch` always requires `--id`.
- `--fetch` refuses to run if the ID is already tracked (use `--pull` to refresh it instead), if `--file-name` isn't kebab-case, or if the computed path already exists on disk but isn't tracked. It also refuses to write to a path that another entry already tracks, and `--force` never overrides that. A path named from the title doesn't hit this: when another entry has it, or the title has no letters or digits, the remote ID is added to the name instead (e.g. `homepage-us-abc-123.json`).
- `--pull` refuses to overwrite a file with unsynced local edits (its content no longer matches the hash recorded in the manifest at the last sync). It reports an artifact that changed on neither side as `skipped` and writes nothing.
- Each result holds `kind`, `id`, `path`, `action`, `status`, and, when known, `remoteVersion`, `message`, and `movedFrom`.
- `--push` refuses to overwrite a remote artifact that changed since the last sync, and reports a file that hasn't changed since the last sync as `skipped`. Bulk `--push` only sends what you edited, but it still reads every tracked artifact from the API to check it hasn't changed remotely.
- Add `--force` to override those checks. With `--push`, `--force` also pushes unchanged files.
- Sync commands never touch git. Only `--fetch` and `--create` add new entries to `sync-manifest.yaml`; everything else requires the artifact to already be tracked.

## Confluence

```bash
# Fetch a page that isn't tracked yet: saves it to a new file in the project's
# confluence/synced/ (named from the page title) and adds it to the manifest
tank confluence --fetch --id=<confluencePageId>

# Fetch with a specific file name instead of one derived from the title
# (must be kebab-case, with or without a trailing .md)
tank confluence --fetch --id=<confluencePageId> --file-name=<kebab-case-name>

# Pull/push one page by its ID or by its file name
tank confluence --pull --id=<confluencePageId>
tank confluence --push --name=datadog.md

# Pull/push every tracked page
tank confluence --pull
tank confluence --push
```

- The local edit check compares against `contentHash`.
- The remote change check compares the page's live version number against `remoteVersion`.
- If only the page's version number moved on (e.g. a metadata-only edit), `--pull` updates `remoteVersion` in the manifest without rewriting the file.
- `--push` refuses markdown that doesn't round-trip through Confluence's format unchanged. Use `--force` to push it anyway.
- `--push` never renames a page: it keeps the live page title, whatever the manifest's `title` says.

Pages can also be created. Confluence assigns the ID, so `--create` takes `--file-name` instead of `--id`:

```bash
# Create a page from a new file you wrote at the project's
# confluence/synced/<kebab-case-name>.md
tank confluence --create --file-name=<kebab-case-name>
```

- Start the file with the page title as a `# ` heading on its first line. It becomes the page title and is left out of the page body, so `--create` rewrites the file without it (the title is kept in the manifest, like for every other page).
- The page is created in `CONFLUENCE_SPACE_ID`, under `CONFLUENCE_PARENT_ID`. Both come from the project's `tank.env`, and both are required.
- `--create` refuses to run if the path is already tracked, if the file doesn't exist or doesn't start with a `# ` heading, if a page with the same title already exists in the space (use `--fetch` instead), or if the body doesn't round-trip through Confluence's format. `--force` isn't supported.

## Datadog

### Dashboards

```bash
# Fetch a dashboard that isn't tracked yet: saves it to a new file in the project's
# datadog/synced/dashboards/ (named from the dashboard title) and adds it to the manifest
tank datadog --dashboards --fetch --id=<dashboardId>

# Fetch with a specific file name instead of one derived from the title
# (must be kebab-case, with or without a trailing .json)
tank datadog --dashboards --fetch --id=<dashboardId> --file-name=<kebab-case-name>

# Pull/push one dashboard by its ID or by its file name
tank datadog --dashboards --pull --id=<dashboardId>
tank datadog --dashboards --push --name=dynamic-rendering.json

# Pull/push every tracked dashboard
tank datadog --dashboards --pull
tank datadog --dashboards --push
```

- The local edit check compares against `contentHash`.
- The remote change check compares the live `modified_at` against `remoteVersion`. Unlike Confluence, Datadog's dashboard API has no integer version field and no server-side optimistic concurrency of its own, so this check is purely client-side.
- The tracked JSON is Datadog's dashboard definition with read-only, server-assigned fields (`id`, `author_handle`, `author_name`, `created_at`, `modified_at`, `url`) stripped out, since those live in the manifest instead.
- If only `modified_at` moved on, `--pull` updates the manifest entry without rewriting the file.

### Log-based metrics

Same `--fetch`/`--pull`/`--push` flow, with `--log-metrics` and the metric name as `--id`:

```bash
tank datadog --log-metrics --fetch --id=mrt.ssr_homepage.isbot.true
tank datadog --log-metrics --push --id=mrt.ssr_homepage.isbot.true
tank datadog --log-metrics --pull
```

Differences from dashboards, all due to Datadog's log-based metrics API:

- Files are named after the metric ID (e.g. the project's `datadog/synced/log-metrics/mrt.ssr_homepage.isbot.true.json`), so for `--pull`, `--push`, and `--delete`, `--name` (with or without `.json`) and `--id` are interchangeable. `--fetch` and `--create` take `--id`.
- The file holds the metric's `filter`, `group_by`, and `compute`.
- Only `filter` and `group_by` can be pushed. Datadog fixes `compute` at creation, so `--push` refuses a local change to it, even with `--force`. Changing it means deleting and recreating the metric, which loses its history.
- The API has no `modified_at`, so the manifest's `remoteVersion` holds a hash of the metric as Datadog returned it at the last sync. `--push` compares it against the live metric to detect changes made in the UI.

Log-based metrics can also be created and deleted. Both always require `--id`:

```bash
# Create a metric from a new file you wrote at the project's
# datadog/synced/log-metrics/<metricId>.json
# (with its filter, group_by, and compute), and add it to the manifest
tank datadog --log-metrics --create --id=mrt.example

# Delete a metric in Datadog, then its JSON file and manifest entry
tank datadog --log-metrics --delete --id=mrt.example
```

- `--create` refuses to run if the metric ID is already tracked (use `--push` instead), if the file doesn't exist, or if the metric already exists in Datadog (use `--fetch` instead). It then rewrites the file with the definition Datadog returns, since Datadog fills in defaults like `group_by: []`. `--force` isn't supported.
- `--delete` refuses to run if the local file has unpushed changes, if the metric changed in Datadog since the last sync, or if the metric no longer exists in Datadog. `--force` overrides all three; for a metric that no longer exists, it only removes the local file and manifest entry.
- Deleting a metric loses its history in Datadog, and dashboard widgets that plot it stop showing data.

Datadog rate-limits some endpoints (e.g. 20 log-based metric reads per 10 seconds), so bulk runs can get a 429. The client waits for the reset time Datadog reports and retries up to 3 times.

### Synthetic tests and suites

In the project's `datadog/synced/synthetics/`, tests live inside the folder of the suite they belong to, so it's clear at a glance which test belongs to which suite:

```
datadog/synced/synthetics/
  s-latency-test-suite-in-content-pages/
    _suite.json                                   # the suite
    s-latency-in-sample-content-page-en-faqs.json # one of its tests
  _no-suite/                                      # tests in no suite
  _multiple-suites/                               # tests in more than one suite
```

Datadog stays the source of truth for membership: the suite's `tests` list in `_suite.json`. A test's folder is never picked by hand; each `--fetch` and `--pull` asks Datadog which suites the test belongs to and puts it in the matching folder.

```bash
# Fetch a suite and every test in it that isn't tracked yet
tank datadog --synthetic-suites --fetch --id=a49-pfw-z8z

# Fetch one test (lands in its suite's folder, or _no-suite)
tank datadog --synthetic-tests --fetch --id=6qc-iye-fgb

# Pull/push one, or every tracked one
tank datadog --synthetic-tests --pull --id=6qc-iye-fgb
tank datadog --synthetic-suites --push
tank datadog --synthetic-tests --pull

# Delete one in Datadog, then its file and manifest entry
tank datadog --synthetic-tests --delete --id=6qc-iye-fgb
tank datadog --synthetic-suites --delete --id=a49-pfw-z8z
```

`--id` is the public ID from the Datadog URL (e.g. `.../synthetics/details/6qc-iye-fgb`). Instead of `--id`, `--pull`, `--push`, and `--delete` also take `--name`:

```bash
# A test's file name, with or without .json, in whichever suite folder it lives
tank datadog --synthetic-tests --push --name=s-latency-in-sample-content-page-us-en-sweatfleece-guide

# A suite's folder name, with or without a trailing /
tank datadog --synthetic-suites --pull --name=s-latency-test-suite-in-content-pages
```

If a test `--name` matches files in more than one folder, the command fails and lists them; use `--id` instead. `--fetch` always requires `--id` (and doesn't take `--file-name`: files are named from the test or suite name).

Tests can also be created. Datadog assigns the ID, so `--create` takes `--file-name` instead of `--id`. Add `--suite` (a tracked suite's folder name) to create the test in that suite:

```bash
# Write the project's datadog/synced/synthetics/s-latency-test-suite-in-category-pages/my-new-test.json, then:
tank datadog --synthetic-tests --create --file-name=my-new-test --suite=s-latency-test-suite-in-category-pages

# Without --suite, the file is read from _no-suite/
tank datadog --synthetic-tests --create --file-name=my-new-test
```

- Write the file as Datadog's test definition without its read-only fields (`public_id`, `monitor_id`, `creator`, `created_at`, `modified_at`). Copying another test's file is the quickest start.
- `--create` refuses to run if the path is already tracked, if the file doesn't exist, or if a test with the same name already exists in Datadog (use `--fetch` instead). With `--suite`, it also refuses if the suite has unpushed changes or changed in Datadog since the last sync.
- It then rewrites the test file from what Datadog returns, adds the test to the suite as a critical test, and rewrites `_suite.json` too. If adding it to the suite fails, the test stays created and tracked, and the suite's result says how to finish by hand.
- The new test starts running in Datadog right away, unless its `status` is `paused`.

Same safety checks as dashboards (`contentHash` for local edits, `remoteVersion` for edits in Datadog, `--force` to override), plus:

- `--synthetic-suites --fetch` and `--pull` also fetch tests in the suite that aren't tracked yet, even when the suite itself is `skipped`. Each fetched test gets its own result after the suite's. `--force` never carries over to them.
- `--synthetic-tests --pull` moves a test's file (and manifest entry) to its new folder when its suite membership changed, e.g. after moving it between suites, or after its suite was deleted.
- To move a test between suites, edit the `tests` list in both `_suite.json` files, push both suites, then pull the test.
- Deleting a suite doesn't delete its tests. Datadog refuses to delete a test that's still in a suite, so `--synthetic-tests --delete` first removes it from its suites and rewrites their `_suite.json` (one result per suite). It refuses to run if any of those suites isn't tracked, has unpushed changes, or changed in Datadog since the last sync.
- Only `api` and `browser` tests can be pushed or created.

## Changing tank

Run the checks before finishing any change:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
```

In VS Code, install the recommended **TypeScript 7** extension (`TypeScriptTeam.native-preview`). `.vscode/settings.json` points it at this repo's TypeScript, so editor errors match `npm run typecheck`.

Every project runs this working copy, with no version pinning. So keep changes backward compatible with existing projects' files. When a change must break them (e.g. a new manifest format), ship in the same change:

- an idempotent migration in `project/migrations.js`, plus a test. Each migration detects for itself whether it applies, since no version is stored in the project. `tank upgrade` then fixes every project.
- a check in the sync commands that fails on the old format and asks to run `tank upgrade`.

To add a tool, define it in its own `<name>/tool.js` (its name, service name, usage description, example commands, kinds, manifest header, domain settings, and `createClient`, whose client reads its credentials through `readUserVariables` in `shared/config.js`), then register it in `project/tools.js`. Its folder (`<name>/`) and manifest (`<name>/sync-manifest.yaml`) follow from its name, and `runCli` gives every adapter that folder as its `rootDir`. `project/tools.js` is the only place tools are listed: it gives the tool a `tank <name>` command and a line in tank's usage text, a folder and manifest on `tank init` and `tank upgrade`, a mention and examples in the project's managed `AGENTS.md` and `README.md` blocks, its domain settings in `tank.env`, and its kinds in the contract's coverage check (each kind still needs a contract fixture). Changing the managed blocks reaches existing projects through `tank upgrade`. A new kind in an existing tool goes through the kind and adapter contract in `CONVENTIONS.md`.

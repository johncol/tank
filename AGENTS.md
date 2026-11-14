# Agent instructions

Before finishing any code change in this repo, run:

```
npm test
npm run typecheck
npm run lint
npm run format:check
```

If `format:check` fails, run `npm run format` to auto-fix, then re-check.

Fix any failures before considering the task done.

## TypeScript checking scope

`tsc --checkJs` runs with `strict: true` but `noImplicitAny: false`. This is
intentional: full JSDoc coverage on every function (so `noImplicitAny` could
be enabled) was considered and rejected as not worth the effort for this
codebase (internal CLI tooling, no external consumers). Add JSDoc types
opportunistically when touching a function, not as a dedicated effort.

## Sync tool conventions

Every action (`--fetch`, `--pull`, `--push`, `--create`, `--delete`) must behave
the same across both tools and every kind of artifact. Before adding or
changing an action, flag, or kind, read `CONVENTIONS.md`, update it
first if the contract needs to change, and make sure the contract tests cover
the change.

- New actions and flags go through `runCli` in `shared/cli.js`, and
  any kind-specific rule is declared as an adapter capability (`actions`,
  `allowsFileName`, `findEntriesByName`, ...), never as a branch on the kind
  in a CLI or in `runCli`.
- A new kind needs an adapter registered in its tool's `lib/kinds.js` (with
  its kind flag) and a contract fixture added to `FIXTURES` in
  `shared/__tests__/action-contract.test.js`.

## Projects and compatibility

tank is used by several projects, and every one runs this working copy. Keep
changes backward compatible with existing projects' files. When a change must
break them, ship an idempotent migration in `project/migrations.js` and a test
for it in the same change, so `tank upgrade` fixes every project.

- New tools are registered in `project/tools.js`, the only place tools are
  listed: tank's usage text, the managed blocks, and the contract coverage
  test are built from it.
- Anything tank writes into projects (manifest headers, the managed blocks in
  `AGENTS.md` and `README.md`, `tank.env` placeholders) changes only through
  `tank upgrade`.

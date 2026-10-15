# Contributing

Thanks! undomap keeps to one job: see [GOAL.md](GOAL.md). Please open an issue before large changes.

## Develop

```bash
npm ci
npm run build       # dist/cli.js, dist/index.js, dist/action.js and the landing page bundle site/app.js
npm test            # node:test + tsx; fixture repos are built with real git in a temp dir
npm run typecheck
node dist/cli.js ~/some/dir --fix
```

`dist/` and `site/app.js` are committed (the GitHub Action runs from `dist/action.js`, Pages serves `site/`). Run `npm run build` and commit them with your change; CI fails if they are stale.

## Accuracy reports

"undomap says X is permanent, but it isn't" (or the reverse) is the most valuable bug report. Please include:

- OS, git version, and the snapshot setup (Time Machine, btrfs, ZFS, none)
- `undomap --json` output for the smallest directory that shows it (paths can be renamed)
- what you expected and why (e.g. "this folder is in Dropbox with version history")

To turn it into a test, add a fixture under `test/fixtures/<name>/` with a `fixture.json` (see `test/helpers.ts` for `commit`, `generate`, `modify`, `remote`, `symlinks`) and a case in `test/map.test.ts`.

## Rules of the house

- undomap is read-only. Never add a code path that writes to the mapped tree, `.git` or the index.
- A probe that fails (missing `tmutil`, no permission) must degrade to "unknown", never fail the run.
- Never print remote URLs: they can carry tokens.
- Fix commands must be safe to paste: quote paths, prefer copies over moves.

## Landing page

`site-src/` is bundled into `site/app.js`; `site/DESIGN.md` is the design brief (flood-inundation survey map). Keep to its palette and type; respect `prefers-reduced-motion`.

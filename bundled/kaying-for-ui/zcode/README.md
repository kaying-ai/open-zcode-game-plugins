# kaying-for-ui · ZCode package (agent contract)

Register this directory as a ZCode plugin (`marketplace.json` at root).

## What you get

```text
skills/kaying-for-ui/SKILL.md     agent pipeline protocol (read first)
skills/kaying-for-ui/references/  stage rules
commands/game-ui-*.md             slash procedures
cli/bin/kui, cli/bin/kui.cmd      launcher (POSIX / Windows)
cli/src/*.mjs                     kui implementation (host-provided Node, no build step)
cli/README.md                     kui output protocol
templates/ schemas/ config/       runtime resources
```

## Agent bootstrap

Plugin root = the directory containing this README (two levels above `skills/kaying-for-ui/SKILL.md`).

```bash
node "<plugin-root>/cli/src/main.mjs" doctor --json
```

`kui` below is shorthand for `node "<plugin-root>/cli/src/main.mjs"`. The Node runtime ships with the host app, so there is nothing to install. `cli/bin/kui` (POSIX) and `cli/bin/kui.cmd` (Windows) launch the same entry point and fall back to the host's bundled Node when `node` is not on PATH.

Follow `skills/kaying-for-ui/SKILL.md`. Prefer `kui … --json` when branching on results.

## Gates

planning approved → style approved → screen scope → page approved → component → split human check → 9-slice review → `kui validate` exit 0.

## Commands

`/game-ui-workflow` · `/game-ui-design` · `/game-ui-pages` · `/game-ui-components` · `/game-ui-export`

Protocol & fixes: `cli/README.md`.

## License & attribution

MIT — see `LICENSE`. The staged workflow and contract conventions were initially
informed by [Game UI Design Workflow](https://github.com/guiguiyan930-source/game-ui-design-workflow)
(MIT, Copyright (c) 2026 Game UI Design Workflow contributors). Its copyright
notice and full license text are in `NOTICE`; both files ship with this package
and must be kept when redistributing it.

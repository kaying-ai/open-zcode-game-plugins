# kui — agent tool protocol

Single binary. No Python/Rust runtime required in the plugin package.

## Output protocol

### Text (default)

```text
STATUS: ok|failed|error
SUMMARY: <one line>
PROJECT: <path>                 # if bound
NEXT: <command> | read <path> | wait_user: <prompt> | none
FACT: key=value
ARTIFACT: <path>
ERROR: CODE | path | message | FIX: <how>
WARN:  CODE | path | message | FIX: <how>
```

### JSON (`--json`)

```json
{
  "ok": true,
  "command": "validate",
  "status": "ok",
  "exit_code": 0,
  "summary": "valid (0 warning(s))",
  "project": "specs/foo",
  "artifacts": ["specs/foo"],
  "errors": [{"code":"E_MISSING","path":"…","message":"…","fix":"…"}],
  "warnings": [{"code":"W_…","path":"…","message":"…","fix":"…"}],
  "next": {"action":"none|run|read|wait_user","command":null,"path":null,"prompt":null},
  "facts": {"error_count": 0}
}
```

### Exit codes

| Code | Status | Agent rule |
|---|---|---|
| 0 | ok | Execute `next` |
| 1 | failed | Fix `errors[]` with each `fix`; re-run |
| 2 | error | Do not retry same args; repair input/env (`kui doctor --json`) |

### Next actions

| `next.action` | Meaning |
|---|---|
| `run` | Execute `next.command` verbatim |
| `read` | Open `next.path` before continuing |
| `wait_user` | Ask user `next.prompt`; do not auto-advance |
| `none` | Stage complete / human gate — stop |

## Commands

```bash
kui init <project-id> [--root DIR] [--base-dir specs] [--force] [--json]
kui validate <project-dir> [--strict] [--json]
kui skills [skills-dir] [--json]
kui split <source.png> [--output-dir D] [--zip Z] [--mode auto|alpha|background]
          [--alpha-threshold N] [--background-tolerance N] [--connect-gap N]
          [--min-area N] [--padding N] [--prefix P] [--mapping F] [--force] [--json]
kui atlas <project> [--sprite-contract F] [--atlas-contract F] [--force] [--json]
kui export <project> [--atlas-contract F] [--export-contract F] [--root DIR] [--force] [--json]
kui web <project> [--root DIR] [--force] [--json]
kui doctor [--json]
```

### Command → success signal

| Command | exit 0 facts / artifacts | Typical next |
|---|---|---|
| `init` | `project`, `files_written` | `kui validate …` |
| `validate` | `error_count=0` | `none` |
| `skills` | `skill_count` | `none` |
| `split` | `item_count`, `detected_mode`, items+zip | `wait_user` edges |
| `atlas` | `sprite_count`, `atlas_size`, png+json | `kui export …` |
| `export` | `manifest_count`, exports/*/ui-main.json + README.md | `kui validate …` |
| `web` | exports/web/*, index.html, result.html | deliver `index.html` preview |
| `doctor` | `root`, `has_*` | `kui init …` |

## Error code classes

| Prefix | Meaning | Fix pattern |
|---|---|---|
| `E_MISSING` | file/dir absent | create or restore from templates |
| `E_SCHEMA` | wrong YAML shape/value | conform contract field |
| `E_MISMATCH` | declared vs actual size/id | correct manifest or file |
| `E_DUPLICATE` | duplicate id | rename |
| `E_REF` | unknown screen/component ref | add definition or fix id |
| `E_GATE` | approval/review gate | complete review fields or approve |
| `E_CONTRACT` | other contract rule | read message + schema |
| `W_*` | same class, non-fatal | fix before production handoff |
| `E_EXEC` | usage/env | change args; `kui doctor` |

## Runtime

`kui` is plain Node.js ESM — there is no compiled binary and no build step.

```text
cli/bin/kui          POSIX launcher (sh) → cli/src/main.mjs
cli/bin/kui.cmd      Windows launcher (cmd) → cli/src/main.mjs
cli/src/*.mjs        the whole CLI (zero third-party dependencies)
```

Requires **Node.js >= 18** on PATH.

```bash
chmod +x cli/bin/kui   # if unzip dropped +x
export PATH="$PATH:$PWD/cli/bin"
kui doctor --json
```

## Checks (maintainer)

```bash
node scripts/check-cli.mjs          # `node --check` every module + launcher sanity
node scripts/build-platforms.mjs
node scripts/verify.mjs
```

Release packages ship `cli/bin/*` + `cli/src/*.mjs` + `cli/README.md` — never Rust sources, Cargo files or `target/`.

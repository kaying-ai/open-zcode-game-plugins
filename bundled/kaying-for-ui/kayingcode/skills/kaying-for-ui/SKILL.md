---
name: kaying-for-ui
description: >-
  Execute the game UI design-and-handoff pipeline for an agent:
  GDD/PRD/interaction, style contract, screen map, page visuals,
  component breakdown, sprite split, atlas, engine JSON.
  Trigger on game UI, UI design, UI spec, page generation, component
  breakdown, sprite sheet, atlas, 9-slice, engine UI handoff, design tokens.
  Use whenever the goal is a coherent multi-screen game UI project in
  specs/<project-id>/, even if the user never says skill.
  Also trigger on Chinese phrasing: 咖影, 游戏界面设计, UI设计, 游戏UI,
  界面延展, 组件拆解, 切图, 雪碧图, 图集, 九宫格, 设计令牌, 引擎UI交付,
  把界面切成图集, 生成游戏页面视觉.
---

# kaying-for-ui — Agent Protocol

You are executing a **stage-gated pipeline**. Persist every fact to `specs/<project-id>/`. Never keep the only copy in chat.

**Workspace law:** `specs/<project-id>/` lives under the **user's working directory** (or an explicit project root the user named). **Never** create or write projects under the plugin install / package path (`~/.config/mimocode/skills/...`, `platform/for*`, plugin repo `cli/` `templates/` `skills/`). Plugin dirs only hold code/templates; if you find a `specs/` inside a plugin install, treat it as pollution — do not extend it; run `kui init` in the user workspace instead.

**Directory layout (keep it flat):**

| User gave… | Do this | Result |
|---|---|---|
| A dedicated project folder (e.g. `…/2048-fense/`) | `kui init <id> --into <that-folder>` | project files **directly** in the folder (`index.html`, `contracts/`, …) |
| Only a workspace parent + a project name | `kui init <id>` from workspace | `<workspace>/specs/<id>/` |
| Nothing | ask for workspace path; never invent plugin install as workspace | — |

**Do not** wrap again: never create `<folder>/specs/<same-id>/` when the folder is already the project. `render/` is optional for pixel helpers only; delete it if empty.

## 0. Start protocol (every task)

Before any stage work, **always** run this three-step start. Do not skip it even if the user only asked for one stage.

### 0.1 Task analysis

Read the user instruction + existing `specs/<project-id>/` (if any) and state:

- Goal: what to produce (docs / pages / components / sprite slicing / atlas + export / full pipeline)
- Scope: which stages, which screen-id
- Current state: which contracts/assets exist, which gates passed or not
- Blockers: missing info, tools unavailable, contract conflicts (write "none" if none)

### 0.2 Work plan (show the user)

Emit a short plan the user can scan in one screen:

```text
PLAN: <one-line goal>
STAGES: <ordered stage list actually needed>
OUTPUTS: <planned paths>
RISKS: <optional>
```

Keep it concrete (paths / stage ids), not marketing prose.

### 0.3 Mode selection (default-first)

**Default is `default` mode.** Do **not** block the pipeline to ask which mode.

| User says / implies | Mode |
|---|---|
| Explicit **review mode** / `review` / "ask me to confirm" / "step-by-step" / "manual review" | `review` |
| Explicit **default mode** / `default` / "just finish it" / "run it through" / "no confirmation" | `default` |
| Affirmative continuation: "continue" "alright" "uh-huh" "OK" "sure" "go ahead" "go" "up to you" "either way" or similar | **`default`** (fallback) |
| Silence / no mode mentioned | **`default`** |

Rules:

- Only enter `review` when the user **explicitly** asks for review/confirmation gates. Otherwise always `default`.
- Show `MODE: default (fallback)` or `MODE: review (user-specified)` in the start PLAN, then **continue immediately** — do not `wait_user` for mode.
- Affirmative one-word replies during a run ("continue" / "OK" / …) never switch to `review` and never stall; keep current mode (usually `default`).
- User may switch modes mid-project. Record the change in `quickstart.md` and restate `MODE:`.
- Persist the active mode under `specs/<id>/quickstart.md` → `## Execution mode` (`review` | `default`, timestamp, who chose).
- Missing blocking inputs still stop in **both** modes (genre / platform / aspect ratio cannot be invented). Optional blanks get explicit defaults.
- `default` is **not** a quality waiver: never fake files, never skip `kui` tools, never mark broken output as approved. It only removes *human* confirmation stops.
- `default` must still stop on tool `exit=2`, unrecoverable `exit=1`, or `NEXT: wait_user` from a non-gate reason (e.g. missing credentials).

## Tool contract (`kui`)

**Resolve the plugin root once, at the start.** The root is the directory that contains `cli/src/main.mjs` and `templates/spec-kit/`. It sits two levels above this file when the skill is installed as part of the full plugin package (`<root>/skills/kaying-for-ui/SKILL.md`), and it **is** the directory containing this file when the skill is installed as a self-contained skill package (WorkBuddy "Upload Skill"). Never guess: check that `cli/src/main.mjs` exists next to the candidate root before using it.

Every `kui` command below means:

```bash
node "<root>/cli/src/main.mjs" <command> [args]
```

The runtime ships with the host app — never ask the user to install Node, npm, or anything else. `cli/bin/kui` (POSIX) and `cli/bin/kui.cmd` (Windows) are equivalent launchers that also fall back to the host's bundled Node; use them only when `cli/bin` is already on `PATH`. Prefer `--json` when you must branch on results.

| Exit | Meaning | Agent action |
|---|---|---|
| 0 | ok | Follow `NEXT` (or stop at human gate) |
| 1 | failed | Fix every `ERROR` / `errors[]` using its `fix`; re-run same command |
| 2 | error | Wrong args/env/missing input — do **not** retry same args |

Text protocol:

```text
STATUS: ok|failed|error
SUMMARY: <one line>
NEXT: <command> | read <path> | wait_user: <prompt> | none
FACT: key=value
ARTIFACT: <path>
ERROR: CODE | path | message | FIX: <how>
WARN:  CODE | path | message | FIX: <how>
```

JSON protocol (`--json`): `{ok, command, status, exit_code, summary, project, artifacts, errors[], warnings[], next:{action,command,path,prompt}, facts{}}`. Problem objects: `{code,path,message,fix}`.

Commands (`kui` = `node "<root>/cli/src/main.mjs"`):

```bash
kui init <project-id> [--force]
kui validate <project-dir> [--strict] [--json]
kui skills [--json]
kui split <sheet.png> [--mapping F] [--force] [--json]
kui atlas <project> [--force] [--json]
kui export <project> [--force] [--json]
kui doctor [--json]
```

## 1. Route (pick ONE path)

After §0 mode is chosen. “stop for approval” below is **`review` only**; in `default` auto-close on quality pass.

| User intent | Load | Then (`review`) | Then (`default`) |
|---|---|---|---|
| planning / PRD / interaction / before image generation | `references/product-design.md` | write gdd/prd/interaction → stop for approval | quality pass → auto-approve → continue or deliver |
| spec / design system / tokens | `references/specification.md` | write style-contract → stop for approval | quality pass → auto-approve |
| page list / screen map | `references/extension.md` | write screen-contract → stop for scope confirm | apply scope → continue |
| single-page visual / prototype | `references/page-generator.md` | one page only → stop for approval | one page (or all if asked) → auto-approve |
| components / sprite slicing / transparent assets | `references/component-breakdown.md` | approved page only | source auto-approved in this run |
| sprite sheet / PNG ZIP | `references/sprite-sheet-splitter.md` | `kui split` → human visual check | `kui split` → auto edge-check |
| atlas / 9-slice / engine JSON | `references/asset-pipeline.md` | `kui atlas` → `kui export` → `kui validate` | same, auto-fill slice defaults |
| full project | this file §2 | full stage order with gates | full stage order, no human stops |

Single-stage request: do **not** force the full pipeline, but always read existing `contracts/` and still run §0.

## 2. Full pipeline (ordered)

For each stage: state inputs → act → write files → run tools → emit stage block → **STOP if gated and MODE=review**.

### Stage block (required after every stage)

```text
STAGE: <id> <name>
MODE: review|default
STATUS: done|blocked|failed
INPUTS: <paths read>
OUTPUTS: <paths written>
GATE: none | <what the user must confirm> | auto-closed (default mode)
NEXT: <exact next command or user prompt>
FIXES: <if failed: bullet list from kui ERROR.fix>
```

### Order and gates

| # | Stage | Action | Gate | `review` | `default` |
|---|---|---|---|---|---|
| 1 | product-design | `kui init <id>` if needed; write `gdd.md` `prd.md` `interaction.md` (`references/product-design.md`) | all three `Document Status / status=approved` (or skip logged) | STOP for approval | quality check pass → set `approved`, log, continue |
| 2 | specify | complete `spec.md` `research.md` | blocking undecided items | STOP | STOP if truly blocking; else apply defaults and log |
| 3 | specification | `contracts/style-contract.yaml` (`references/specification.md`) | style-contract approved | STOP for approval | quality check pass → `approved`, continue |
| 4 | extension | `plan.md` + `contracts/screen-contract.yaml` | screen scope confirmed | STOP for scope | apply stated/derived scope, log, continue |
| 5 | page | one screen: `prompts/pages/<id>.md` + `assets/pages/<id>.*` + `asset-manifest.yaml` | page approved | STOP per page | generate all planned screens; auto-approve on quality pass |
| 6 | component | `component-contract.yaml` + `assets/components/` | source page `approved: true` | requires prior approval | auto-approved source allowed |
| 7 | split | `kui split …` (`references/sprite-sheet-splitter.md`) | human: text/crop/glow edges | STOP for visual check | auto-check (no text residue / sane crops) → continue; flag issues in summary |
| 8 | atlas+export | `kui atlas` → `kui export` (`references/asset-pipeline.md`) | semantic map + 9-slice reviewed | STOP for review | auto-fill reasonable margins from `config/slice-rules.yaml`; flag uncertain slices in summary |
| 8b | web pack | `kui web specs/<id>` → `exports/web/` + `result.html` + `index.html` | deliver `index.html` per §7 | same | same |
| 9 | validate | `kui validate specs/<id> --json` | exit 0 → deliver §7 | same | same; deliver one-shot report of auto-closed gates |

Hard rules:

- **Start protocol (§0) is mandatory** before stage 1 or any single-stage run.
- Image tool missing → `status: pending-generation`, keep prompt, **never fake a file**.
- `review`: do not start stage N+1 if stage N gate is closed. User says "skip" → record in `quickstart.md` and continue.
- `default`: do not stop at human gates; still run every quality check. On check pass, set the gate field (`approved` / `status: approved` / `review.complete: true`) and append one line to `quickstart.md` (`default-mode auto-closed <stage>: <why OK>`).
- `contracts/` is the single visual source of truth; never silently rewrite.
- Do not overwrite approved assets; bump version and keep lineage in `asset-manifest.yaml`.
- All assets registered in `contracts/asset-manifest.yaml`.
- Mode switches are logged; never silently run half a project under one mode and half under another.

## 3. Init

```bash
kui init <project-id> --json
```

- `project-id`: `^[a-z0-9]+(-[a-z0-9]+)*$`
- If `STATUS: failed`, apply each `ERROR.fix` (usually `--force` or bad id).
- Then `kui validate specs/<project-id> --json` once; treat warnings as known draft gaps.

## 4. Image generation rules

1. Use contract aspect ratio. If unsupported, nearest ratio + record actual size in manifest.
2. CJK text often garbles → generate text-free base + mark layout zones; never claim garbled text is deliverable.
3. Components one-per-file; never flatten many components into one final deliverable image.
4. Move tool output into `assets/…` then register the **real** path.

## 5. Recovery

| Signal | Action |
|---|---|
| `exit=2` | Fix args/env (`kui doctor --json`); do not loop same command |
| `exit=1` | Sort `errors[]` by `path`; fix `message` using `fix`; re-run |
| `WARN` only | `review`: proceed only if gate allows; document in `quickstart.md`. `default`: proceed and log the warning in the final summary |
| `NEXT: wait_user` (gate) | `review`: ask that prompt and stop. `default`: skip the ask; auto-close if quality allows, else stop with the reason |
| `NEXT: wait_user` (non-gate) | Ask the user in **both** modes (missing info / env / credentials) |
| `NEXT: none` | Emit stage block and stop (or continue pipeline if more stages remain in `default`) |
| Contract mismatch | Update contract first, mark affected assets `stale`, regenerate |
| Mode unknown | Re-read `quickstart.md`; if still missing, stop and ask for mode (do not guess) |

**Tooling law:** pipeline steps (init / validate / split / atlas / export) **must** call `kui`. Do **not** write ad-hoc Python/Node scripts for those steps, and do **not** invent `scripts/*.py` paths. If no image-generation tool exists, you may render deterministic artboards (e.g. HTML + headless screenshot) **only for pixels**; still finish with `kui split` / `kui atlas` / `kui export` / `kui validate`. Any helper you create for pixels goes under `render/` and must not replace `kui` contracts.

## 6. Done definition

- start protocol ran; mode recorded in `quickstart.md` (`review` | `default`)
- planning docs approved (or skip logged; `default`: auto-approved + logged)
- required contracts present and IDs/paths consistent
- page/component images exist or `pending-generation`
- prompts reproducible
- if sprites used: PNG set + manifest + ZIP present
- if handoff used: atlas JSON + engine JSON consistent
- every enabled engine export folder contains `ui-main.json` + `README.md` (Agent auto-integration guide)
- if `taptap-maker` target enabled: `exports/taptap-maker/` contains `ui-main.json` + `theme.lua` + `component-map.json` + `screens.json` + `README.md` (`demo/` is an optional reference implementation; events only log with the `[kui-demo]` prefix)
- web pack generated: `exports/web/manifest.json`, `exports/web/README.md`, `result.html`, `index.html` (`kui web`)
- `kui validate specs/<id> --json` → `ok: true`, `exit_code: 0`
- `default`: final summary lists every auto-closed gate + any visual caveats
- delivery done: `index.html` opened via §7 (right panel **or** summary link + system browser)

## 7. Delivery (open `index.html`)

Required when work is complete (`validate` exit 0 **and** web pack present). Entry file: `specs/<id>/index.html` (catalog). `result.html` is secondary (interactive shell) — link it, do not auto-open unless asked.

| Environment | Do this |
|---|---|
| Host has a right / preview panel you can drive | Open `index.html` in that panel. Do **not** also launch a browser. |
| No panel, or panel capability unknown | Put a clickable link (absolute path) to `index.html` in the final task summary **and** open it in the system browser (`open` on macOS, `xdg-open` on Linux, `start` on Windows). |

Final summary always includes:

```text
PREVIEW: <absolute-path>/index.html
PREVIEW_ALT: <absolute-path>/result.html
```

Never finish without one of the two open paths above.

## 8. User-facing stage reply (copy structure)

```text
STAGE: …
MODE: review|default
STATUS: …
INPUTS: …
OUTPUTS: …
GATE: …
NEXT: …
```

Do not add marketing prose. Prefer paths and exact commands.

### Start reply (copy structure)

```text
PLAN: …
STAGES: …
OUTPUTS: …
MODE: default (fallback) | review (user-specified)
GATE: none (default) | review gates apply
NEXT: run first stage command
```

## 9. License & attribution

MIT — see the `LICENSE` file shipped with this package. The staged workflow and
contract conventions were initially informed by
[Game UI Design Workflow](https://github.com/guiguiyan930-source/game-ui-design-workflow)
(MIT, Copyright (c) 2026 Game UI Design Workflow contributors). Its copyright
notice and full license text are in the `NOTICE` file shipped with this package.
Do not remove either file when repackaging this skill.

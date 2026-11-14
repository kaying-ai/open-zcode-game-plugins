---
name: game-ui-workflow
description: Agent procedure — run the full kaying-for-ui pipeline from concept to validated engine JSON. Use when the user wants the whole UI project, not one artifact.
---

Execute the **full** pipeline in `skills/kaying-for-ui/SKILL.md` §2. Bind every tool result to the agent protocol (`--json`, exit 0/1/2).

## Procedure

0. **Start protocol (mandatory, SKILL.md §0)**
   - Analyze the task → emit `PLAN` / `STAGES` / `OUTPUTS`.
   - **STOP** for mode: `review` (multi-step confirmation) or `default` (run to completion and deliver).
   - If the user already named the mode in the instruction, record it and continue.

1. **Bind project**
   - Derive `project-id` (`^[a-z0-9]+(-[a-z0-9]+)*$`).
   - `kui init <project-id> --json` → if `exit=2`, fix args; if `exit=1`, apply `errors[].fix`.
   - `kui validate specs/<project-id> --json` baseline.

2. **Stage 1 product-design** (`references/product-design.md`)
   - Write `gdd.md` `prd.md` `interaction.md` with `Document Status / status`.
   - `review`: **STOP** until all three are `approved` (or skip logged in `quickstart.md`).
   - `default`: quality-check → set `approved` → log in `quickstart.md` → continue.

3. **Stages 2–4** specify → specification → extension
   - Fill `spec.md` `research.md`.
   - Write `contracts/style-contract.yaml` → gate: approved.
   - Write `plan.md` + `contracts/screen-contract.yaml` → gate: scope confirmed.
   - `default`: auto-close each gate on quality pass (blocking unknowns still stop).

4. **Stage 5 page** (`references/page-generator.md`)
   - `prompts/pages/<screen-id>.md` + `assets/pages/<screen-id>.*` + `asset-manifest.yaml`.
   - `review`: one screen per turn, **STOP** for page approval.
   - `default`: generate every planned screen in sequence; auto-approve on quality pass.

5. **Stages 6–8** component → split → atlas/export
   - Only on `approved` pages (`references/component-breakdown.md`).
   - `kui split <sheet.png> --json` if sprite sheet (`references/sprite-sheet-splitter.md`).
     - `review`: **STOP** for visual edge check.
     - `default`: auto edge-check, flag issues in final summary.
   - `kui atlas specs/<id> --json` then `kui export specs/<id> --json` (`references/asset-pipeline.md`).
   - Gate: semantic names + 9-slice reviewed (`default`: use `config/slice-rules.yaml` defaults, flag uncertain).

6. **Stage 9**
   - `kui validate specs/<id> --strict --json`
   - Success iff `exit_code=0` / `ok=true`.

7. **Delivery (required)**
   - Entry: `specs/<id>/index.html` (catalog). `result.html` is secondary — link only.
   - Host has a usable right/preview panel → open `index.html` there (no browser).
   - Otherwise → put the link in the task summary **and** open `index.html` in the system browser (`open` / `xdg-open` / `start`).
   - Final summary must list `PREVIEW:` / `PREVIEW_ALT:` absolute paths (see SKILL.md §7).
   - `default`: also list every auto-closed gate and visual caveats.

## Emit after every stage

```text
STAGE: <n> <name>
MODE: review|default
STATUS: done|blocked|failed
INPUTS: …
OUTPUTS: …
GATE: …
NEXT: <exact command or user question>
```

## Never

- Start stage work before the mode gate (§0.3) is resolved.
- `review`: skip a planning/page/split gate without a logged skip.
- `default`: stop at human gates or silently skip quality checks.
- Generate pages before style contract approval (or `default` auto-close).
- Split or atlas from an unapproved source page/sheet (`review`) / non-quality-passed source (`default`).
- Fake image files when the image tool is down (`pending-generation` + prompt only).
- Silently edit `contracts/` after later stages.

Arguments: project-id or concept (required), reference image path (optional), platform/aspect ratio (optional), execution mode (optional: review|default).
